import fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.ts";
import { createSessionToken, SESSION_COOKIE_NAME } from "../auth/session.ts";
import type { Role } from "../db/types.ts";
import cleanerRoutes from "./cleaner.ts";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

// Every test opens its own throwaway `:memory:` DB (migrate() runs as part
// of createConnection(), see task 001's src/db/schema.test.ts) and a fresh
// Fastify instance registered with this task's routes — no real HTTP server
// or shared state between tests.
function buildApp(db: Database.Database): FastifyInstance {
  const app = fastify();
  app.register(cleanerRoutes, { db });
  return app;
}

function cookieHeader(userId: number, role: Role): string {
  const token = createSessionToken({ user_id: userId, role });
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function insertUser(db: Database.Database, username: string, role: Role): number {
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, "hash", role);
  return Number(result.lastInsertRowid);
}

function insertCleaner(db: Database.Database, username: string, rank: "legend" | "awesome" | "normal" = "normal"): number {
  const userId = insertUser(db, username, "cleaner");
  db.prepare("INSERT INTO cleaners (user_id, rank) VALUES (?, ?)").run(userId, rank);
  return userId;
}

function insertProperty(db: Database.Database, name: string): number {
  const result = db
    .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
    .run(name, "1 Example St");
  return Number(result.lastInsertRowid);
}

describe("GET /api/me", () => {
  it("401s with no session cookie", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("404s for a logged-in user with no cleaners row (e.g. admin)", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const adminId = insertUser(db, "admin-1", "admin");
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieHeader(adminId, "admin") },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns username, rank, score (null under 5 reviews), empty picks, and full cap as slots_remaining", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-1", "awesome");

    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      username: "cleaner-1",
      rank: "awesome",
      score: null,
      picks: [],
      slots_remaining: 3,
    });
  });

  it("reflects slots-remaining correctly after a claim", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-2", "awesome");
    const propertyId = insertProperty(db, "Sunset Villa");

    const claim = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { property_id: propertyId },
    });
    expect(claim.statusCode).toBe(201);

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
    });
    const body = me.json();
    expect(body.slots_remaining).toBe(2);
    expect(body.picks).toEqual([{ id: expect.any(Number), property_id: propertyId, slot: 1 }]);
  });
});

describe("POST /api/picks", () => {
  it("rejects an admin session with 403", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const adminId = insertUser(db, "admin-2", "admin");
    const propertyId = insertProperty(db, "Hilltop House");

    const res = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(adminId, "admin") },
      payload: { property_id: propertyId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects (400) a claim when the cleaner has no free slot", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-3", "normal"); // cap 0
    const propertyId = insertProperty(db, "Lakeside Cabin");

    const res = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { property_id: propertyId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects (400) a claim once the rank's cap is already used", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-4", "awesome"); // cap 3
    const p1 = insertProperty(db, "P1");
    const p2 = insertProperty(db, "P2");
    const p3 = insertProperty(db, "P3");
    const p4 = insertProperty(db, "P4");
    const cookie = cookieHeader(cleanerId, "cleaner");

    for (const propertyId of [p1, p2, p3]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/picks",
        headers: { cookie },
        payload: { property_id: propertyId },
      });
      expect(res.statusCode).toBe(201);
    }

    const overCap = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie },
      payload: { property_id: p4 },
    });
    expect(overCap.statusCode).toBe(400);
  });

  it("assigns ascending free slot numbers", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-5", "legend"); // cap 5
    const cookie = cookieHeader(cleanerId, "cleaner");

    const first = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie },
      payload: { property_id: insertProperty(db, "A") },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie },
      payload: { property_id: insertProperty(db, "B") },
    });
    expect(first.json().slot).toBe(1);
    expect(second.json().slot).toBe(2);
  });

  it("gets 409 when a second cleaner races a claim on an already-taken property", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerA = insertCleaner(db, "cleaner-6a", "awesome");
    const cleanerB = insertCleaner(db, "cleaner-6b", "awesome");
    const propertyId = insertProperty(db, "Contested Villa");

    const first = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerA, "cleaner") },
      payload: { property_id: propertyId },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerB, "cleaner") },
      payload: { property_id: propertyId },
    });
    expect(second.statusCode).toBe(409);
  });

  it("400s a missing/invalid property_id", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-7", "legend");

    const res = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s a property_id that doesn't exist", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-8", "legend");

    const res = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { property_id: 9999 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/picks/:id", () => {
  it("lets a cleaner delete their own pick", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-9", "awesome");
    const propertyId = insertProperty(db, "Own Pick House");
    const cookie = cookieHeader(cleanerId, "cleaner");

    const claim = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie },
      payload: { property_id: propertyId },
    });
    const pickId = claim.json().id;

    const del = await app.inject({ method: "DELETE", url: `/api/picks/${pickId}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.json().slots_remaining).toBe(3);
  });

  it("403s a cleaner deleting another cleaner's pick", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const owner = insertCleaner(db, "cleaner-10a", "awesome");
    const other = insertCleaner(db, "cleaner-10b", "awesome");
    const propertyId = insertProperty(db, "Not Yours House");

    const claim = await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(owner, "cleaner") },
      payload: { property_id: propertyId },
    });
    const pickId = claim.json().id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/picks/${pickId}`,
      headers: { cookie: cookieHeader(other, "cleaner") },
    });
    expect(del.statusCode).toBe(403);
  });

  it("404s deleting a pick that doesn't exist", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-11", "awesome");

    const del = await app.inject({
      method: "DELETE",
      url: "/api/picks/9999",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
    });
    expect(del.statusCode).toBe(404);
  });
});

describe("GET /api/leaderboard", () => {
  it("401s with no session", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/leaderboard" });
    expect(res.statusCode).toBe(401);
  });

  it("is readable by any logged-in role and lists rank + score per cleaner", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const adminId = insertUser(db, "admin-3", "admin");
    const legendId = insertCleaner(db, "legend-1", "legend");
    const normalId = insertCleaner(db, "normal-1", "normal");

    const res = await app.inject({
      method: "GET",
      url: "/api/leaderboard",
      headers: { cookie: cookieHeader(adminId, "admin") },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cleaner_id: number; rank: string; score: number | null }[];
    const byId = new Map(body.map((e) => [e.cleaner_id, e]));
    expect(byId.get(legendId)?.rank).toBe("legend");
    expect(byId.get(normalId)?.rank).toBe("normal");
    // legend (better tier) sorts ahead of normal.
    expect(body.findIndex((e) => e.cleaner_id === legendId)).toBeLessThan(
      body.findIndex((e) => e.cleaner_id === normalId),
    );
  });
});

describe("GET /api/properties", () => {
  it("401s with no session", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/properties" });
    expect(res.statusCode).toBe(401);
  });

  it("lists properties with owner username when claimed, else null", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "owner-cleaner", "awesome");
    const claimed = insertProperty(db, "Claimed Place");
    const unclaimed = insertProperty(db, "Unclaimed Place");

    await app.inject({
      method: "POST",
      url: "/api/picks",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { property_id: claimed },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/properties",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
    });
    const body = res.json() as { id: number; owner: string | null }[];
    const byId = new Map(body.map((p) => [p.id, p.owner]));
    expect(byId.get(claimed)).toBe("owner-cleaner");
    expect(byId.get(unclaimed)).toBeNull();
  });
});
