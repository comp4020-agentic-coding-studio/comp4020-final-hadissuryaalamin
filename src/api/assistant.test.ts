import fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection } from "../db/connection.ts";
import { createSessionToken, SESSION_COOKIE_NAME } from "../auth/session.ts";
import type { Role } from "../db/types.ts";
import assistantRoutes from "./assistant.ts";
import { runAssistant } from "../assistant/client.ts";

vi.mock("../assistant/client.ts", () => ({
  runAssistant: vi.fn(),
}));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

beforeEach(() => {
  vi.mocked(runAssistant).mockClear();
});

// Every test opens its own throwaway `:memory:` DB (migrate() runs as part
// of createConnection(), see task 001's src/db/schema.test.ts) and a fresh
// Fastify instance registered with this task's routes — no real HTTP server
// or shared state between tests. runAssistant is mocked throughout: never a
// real Anthropic call.
function buildApp(db: Database.Database): FastifyInstance {
  const app = fastify();
  app.register(assistantRoutes, { db });
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

describe("POST /api/assistant", () => {
  it("401s with no session cookie", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      payload: { message: "hi" },
    });
    expect(res.statusCode).toBe(401);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("400s a missing message", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("400s a non-string message", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-2");
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { message: 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("400s a message that is empty after trim", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-3");
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { message: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("400s a message over 2000 characters", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-4");
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { message: "a".repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("200s with { reply } on success, scoped to role cleaner", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-5");
    vi.mocked(runAssistant).mockResolvedValue("you are rank normal");

    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { message: "what's my rank?" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: "you are rank normal" });
    expect(runAssistant).toHaveBeenCalledWith("what's my rank?", {
      db,
      role: "cleaner",
      userId: cleanerId,
    });
  });

  it("200s with { reply } on success, scoped to role admin (no cleaner row)", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const adminId = insertUser(db, "admin-1", "admin");
    vi.mocked(runAssistant).mockResolvedValue("5 reviews this period");

    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(adminId, "admin") },
      payload: { message: "how many reviews this period?" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: "5 reviews this period" });
    expect(runAssistant).toHaveBeenCalledWith("how many reviews this period?", {
      db,
      role: "admin",
      userId: adminId,
    });
  });

  it("502s with { error } when runAssistant throws", async () => {
    const db = createConnection(":memory:");
    const app = buildApp(db);
    const cleanerId = insertCleaner(db, "cleaner-6");
    vi.mocked(runAssistant).mockRejectedValue(new Error("Could not reach the assistant right now."));

    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      headers: { cookie: cookieHeader(cleanerId, "cleaner") },
      payload: { message: "hello" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "Could not reach the assistant right now." });
  });
});
