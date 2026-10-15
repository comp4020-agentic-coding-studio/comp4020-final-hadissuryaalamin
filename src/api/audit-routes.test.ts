import fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createConnection } from "../db/connection.ts";
import { createSessionToken, SESSION_COOKIE_NAME } from "../auth/session.ts";
import type { Role } from "../db/types.ts";
import cleanerRoutes from "./cleaner.ts";
import adminRoutes from "./admin.ts";

vi.mock("../realtime/broadcast.ts", () => ({ broadcast: vi.fn() }));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

const writes: string[] = [];
const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
  writes.push(String(chunk));
  return true;
});

afterEach(() => {
  writes.length = 0;
});

function auditLines(): { actor: string; role: string; action: string; outcome: string; detail: string }[] {
  return writes.filter((w) => w.includes('"audit":true')).map((w) => JSON.parse(w));
}

function build(db: Database.Database): FastifyInstance {
  const app = fastify();
  app.register(cleanerRoutes, { db });
  app.register(adminRoutes, { db });
  return app;
}

function cookie(userId: number, role: Role): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken({ user_id: userId, role }))}`;
}

function seed(db: Database.Database) {
  const user = (name: string, role: Role) =>
    Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'h', ?)").run(name, role).lastInsertRowid);
  const alice = user("alice", "cleaner");
  const bob = user("bob", "cleaner");
  const admin = user("boss", "admin");
  db.prepare("INSERT INTO cleaners (user_id, rank) VALUES (?, 'legend'), (?, 'legend')").run(alice, bob);
  const property = Number(db.prepare("INSERT INTO properties (name, address) VALUES ('Lakeside', '1 Lake St')").run().lastInsertRowid);
  return { alice, bob, admin, property };
}

describe("audit log lines from routes", () => {
  it("names both cleaners in a claim race, the winner ok and the loser refused", async () => {
    const db = createConnection(":memory:");
    const { alice, bob, property } = seed(db);
    const app = build(db);

    await app.inject({ method: "POST", url: "/api/picks", headers: { cookie: cookie(alice, "cleaner") }, payload: { property_id: property } });
    await app.inject({ method: "POST", url: "/api/picks", headers: { cookie: cookie(bob, "cleaner") }, payload: { property_id: property } });

    expect(auditLines()).toEqual([
      expect.objectContaining({ actor: "alice", action: "claim", outcome: "ok", detail: expect.stringContaining('"Lakeside"') }),
      expect.objectContaining({ actor: "bob", action: "claim", outcome: "refused", detail: expect.stringContaining("already-claimed") }),
    ]);
  });

  it("logs a cleaner trying to release someone else's pick as refused, by name", async () => {
    const db = createConnection(":memory:");
    const { alice, bob, property } = seed(db);
    const app = build(db);
    const claim = await app.inject({ method: "POST", url: "/api/picks", headers: { cookie: cookie(alice, "cleaner") }, payload: { property_id: property } });
    writes.length = 0;

    await app.inject({ method: "DELETE", url: `/api/picks/${claim.json().id}`, headers: { cookie: cookie(bob, "cleaner") } });

    expect(auditLines()).toEqual([
      expect.objectContaining({ actor: "bob", action: "release", outcome: "refused", detail: expect.stringContaining("forbidden") }),
    ]);
  });

  it("logs admin changes with the admin's name and never the new cleaner's password", async () => {
    const db = createConnection(":memory:");
    const { admin } = seed(db);
    const app = build(db);

    await app.inject({ method: "POST", url: "/api/cleaners", headers: { cookie: cookie(admin, "admin") }, payload: { username: "carol", password: "s3cret-pw" } });

    const lines = auditLines();
    expect(lines).toEqual([expect.objectContaining({ actor: "boss", role: "admin", action: "create-cleaner", outcome: "ok", detail: "carol" })]);
    expect(writes.join("")).not.toContain("s3cret-pw");
  });
});

void spy;
