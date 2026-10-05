import { beforeAll, describe, expect, it } from "vitest";
import fastify from "fastify";
import type Database from "better-sqlite3";
// Import createConnection from connection.ts directly (not db/index.ts),
// which also exports a live `db` singleton opened at import time against
// DATA_DIR/./data — avoided here so these tests only ever touch throwaway
// in-memory DBs (see src/db/schema.test.ts for the same pattern).
import { createConnection } from "../db/connection.ts";
import { createSessionToken, SESSION_COOKIE_NAME } from "../auth/index.ts";
import type { CleanerRow, PickRow } from "../db/types.ts";
import adminRoutes from "./admin.ts";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

// Every test opens its own throwaway `:memory:` DB (see src/db/schema.test.ts
// for the pattern) and builds a fresh Fastify instance wired to it via
// .inject() — no real HTTP server/port needed.
function buildApp(db: Database.Database) {
  const app = fastify();
  app.register(adminRoutes, { db });
  return app;
}

function cookieFor(userId: number, role: "admin" | "cleaner"): string {
  const token = createSessionToken({ user_id: userId, role });
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function insertAdmin(db: Database.Database, username = "admin1"): number {
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'hash', 'admin')")
    .run(username);
  return Number(result.lastInsertRowid);
}

/** Inserts a users + cleaners row directly, bypassing createCleanerAccount's
 * password hashing (irrelevant to these tests). */
function insertCleaner(db: Database.Database, username: string, rank: CleanerRow["rank"] = "normal"): number {
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'hash', 'cleaner')")
    .run(username);
  const userId = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO cleaners (user_id, rank) VALUES (?, ?)").run(userId, rank);
  return userId;
}

function insertProperty(db: Database.Database, name: string): number {
  const result = db.prepare("INSERT INTO properties (name, address) VALUES (?, '1 Test St')").run(name);
  return Number(result.lastInsertRowid);
}

function insertPick(db: Database.Database, cleanerId: number, propertyId: number, slot: number): void {
  db.prepare("INSERT INTO picks (cleaner_id, property_id, slot) VALUES (?, ?, ?)").run(
    cleanerId,
    propertyId,
    slot,
  );
}

function insertReviews(db: Database.Database, cleanerId: number, period: string, stars: number[]): void {
  const insert = db.prepare("INSERT INTO reviews (cleaner_id, stars, period) VALUES (?, ?, ?)");
  for (const s of stars) insert.run(cleanerId, s, period);
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

describe("admin API — auth", () => {
  it.each([
    { method: "POST", url: "/api/properties", payload: { name: "A", address: "B" } },
    { method: "PUT", url: "/api/properties/1", payload: { name: "A" } },
    { method: "DELETE", url: "/api/properties/1", payload: undefined },
    { method: "POST", url: "/api/cleaners", payload: { username: "x", password: "y" } },
    { method: "POST", url: "/api/reviews/batch", payload: [] },
    { method: "POST", url: "/api/cleaners/1/rank", payload: { rank: "legend" } },
  ])("rejects a cleaner session on $method $url with 403", async ({ method, url, payload }) => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cleaner-auth");
    const app = buildApp(db);

    const response = await app.inject({
      method: method as "POST" | "PUT" | "DELETE",
      url,
      payload,
      headers: { cookie: cookieFor(cleanerId, "cleaner") },
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects every route with 401 when there's no session at all", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);

    const response = await app.inject({ method: "POST", url: "/api/properties", payload: {} });
    expect(response.statusCode).toBe(401);
  });
});

describe("admin API — properties CRUD", () => {
  it("creates, updates, and deletes a property as admin", async () => {
    const db = createConnection(":memory:");
    const adminId = insertAdmin(db);
    const app = buildApp(db);
    const cookie = cookieFor(adminId, "admin");

    const created = await app.inject({
      method: "POST",
      url: "/api/properties",
      payload: { name: "Sunset Villa", address: "1 Beach Rd" },
      headers: { cookie },
    });
    expect(created.statusCode).toBe(201);
    const property = created.json() as { id: number; name: string };

    const updated = await app.inject({
      method: "PUT",
      url: `/api/properties/${property.id}`,
      payload: { name: "Sunset Villa II" },
      headers: { cookie },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Sunset Villa II");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/properties/${property.id}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);

    const row = db.prepare("SELECT * FROM properties WHERE id = ?").get(property.id);
    expect(row).toBeUndefined();
  });
});

describe("admin API — create cleaner", () => {
  it("creates a cleaner account with a matching cleaners row defaulted to normal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertAdmin(db);
    const app = buildApp(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/cleaners",
      payload: { username: "new-cleaner", password: "s3cret!" },
      headers: { cookie: cookieFor(adminId, "admin") },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { user_id: number; username: string; rank: string };
    expect(body.username).toBe("new-cleaner");
    expect(body.rank).toBe("normal");

    const row = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(body.user_id) as CleanerRow;
    expect(row.rank).toBe("normal");
  });
});

describe("admin API — reviews batch", () => {
  it("inserts reviews, recomputes ranks, and drops excess picks in one call", async () => {
    const db = createConnection(":memory:");
    const adminId = insertAdmin(db);
    const period = currentPeriod();

    // Cleaner starts at `legend` (5 picks, the full cap) but this batch only
    // gives them 3 reviews -> ineligible (<5) -> forced `normal` -> cap 0,
    // so the recompute must drop all 5 existing picks.
    const star = insertCleaner(db, "star-cleaner", "legend");
    const prop1 = insertProperty(db, "P1");
    const prop2 = insertProperty(db, "P2");
    const prop3 = insertProperty(db, "P3");
    const prop4 = insertProperty(db, "P4");
    const prop5 = insertProperty(db, "P5");
    insertPick(db, star, prop1, 1);
    insertPick(db, star, prop2, 2);
    insertPick(db, star, prop3, 3);
    insertPick(db, star, prop4, 4);
    insertPick(db, star, prop5, 5);

    // Only 3 reviews this period -> ineligible (< 5) -> forced normal, which
    // has cap 0, so all 5 of star-cleaner's picks must be dropped.
    const app = buildApp(db);
    const response = await app.inject({
      method: "POST",
      url: "/api/reviews/batch",
      payload: [
        { cleaner_id: star, stars: 5 },
        { cleaner_id: star, stars: 5 },
        { cleaner_id: star, stars: 5 },
      ],
      headers: { cookie: cookieFor(adminId, "admin") },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ period, count: 3 });

    const row = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(star) as CleanerRow;
    expect(row.rank).toBe("normal");

    const remainingPicks = db.prepare("SELECT * FROM picks WHERE cleaner_id = ?").all(star) as PickRow[];
    expect(remainingPicks).toHaveLength(0);

    const reviewRows = db.prepare("SELECT * FROM reviews WHERE cleaner_id = ?").all(star);
    expect(reviewRows).toHaveLength(3);
  });

  it("promotes an eligible cleaner to legend across 15+ eligible peers without touching others' picks", async () => {
    const db = createConnection(":memory:");
    const adminId = insertAdmin(db);
    const period = currentPeriod();

    // 16 other cleaners, each already with 5 reviews averaging 5.0, so our
    // cleaner-under-test (with a slightly lower average) lands at position
    // 16 -> awesome, not legend; picks within the new cap (3) survive.
    for (let i = 0; i < 16; i++) {
      const id = insertCleaner(db, `filler-${i}`);
      insertReviews(db, id, period, [5, 5, 5, 5, 5]);
    }

    const cleanerId = insertCleaner(db, "mid-cleaner", "normal");
    const propA = insertProperty(db, "A");
    const propB = insertProperty(db, "B");
    insertPick(db, cleanerId, propA, 1);
    insertPick(db, cleanerId, propB, 2);

    const app = buildApp(db);
    const response = await app.inject({
      method: "POST",
      url: "/api/reviews/batch",
      // Average after dropping the lowest (1) = (5+5+5+5)/4 = 5.0, but fewer
      // total reviews (5 vs fillers' 5) ties on count too -> tie-break by
      // cleaner id puts this cleaner after all lower-id fillers, landing at
      // position 16 (0-indexed) -> awesome.
      payload: [
        { cleaner_id: cleanerId, stars: 5 },
        { cleaner_id: cleanerId, stars: 5 },
        { cleaner_id: cleanerId, stars: 5 },
        { cleaner_id: cleanerId, stars: 5 },
        { cleaner_id: cleanerId, stars: 1 },
      ],
      headers: { cookie: cookieFor(adminId, "admin") },
    });

    expect(response.statusCode).toBe(200);

    const row = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(cleanerId) as CleanerRow;
    expect(row.rank).toBe("awesome");

    const picks = db.prepare("SELECT * FROM picks WHERE cleaner_id = ?").all(cleanerId) as PickRow[];
    expect(picks).toHaveLength(2);
  });
});

describe("admin API — rank override", () => {
  it("writes the rank directly and drops excess picks per the new cap, without touching reviews", async () => {
    const db = createConnection(":memory:");
    const adminId = insertAdmin(db);
    const cleanerId = insertCleaner(db, "override-me", "legend");
    const props = [1, 2, 3, 4, 5].map((n) => insertProperty(db, `Prop ${n}`));
    props.forEach((propId, i) => insertPick(db, cleanerId, propId, i + 1));

    const app = buildApp(db);
    const response = await app.inject({
      method: "POST",
      url: `/api/cleaners/${cleanerId}/rank`,
      payload: { rank: "awesome" },
      headers: { cookie: cookieFor(adminId, "admin") },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as CleanerRow;
    expect(body.rank).toBe("awesome");

    // awesome's cap is 3 -> slots 4 and 5 dropped, 1-3 kept.
    const picks = (db.prepare("SELECT * FROM picks WHERE cleaner_id = ?").all(cleanerId) as PickRow[])
      .map((p) => p.slot)
      .sort((a, b) => a - b);
    expect(picks).toEqual([1, 2, 3]);

    const reviewRows = db.prepare("SELECT * FROM reviews WHERE cleaner_id = ?").all(cleanerId);
    expect(reviewRows).toHaveLength(0);
  });

  it("404s overriding a rank for a cleaner that doesn't exist", async () => {
    const db = createConnection(":memory:");
    const adminId = insertAdmin(db);
    const app = buildApp(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/cleaners/999/rank",
      payload: { rank: "legend" },
      headers: { cookie: cookieFor(adminId, "admin") },
    });

    expect(response.statusCode).toBe(404);
  });
});
