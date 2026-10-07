import type Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.ts";
import type { Role } from "../db/types.ts";
import { runTool, TOOLS_FOR_ROLE } from "./tools.ts";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

// Same throwaway `:memory:` DB + helper pattern as src/api/cleaner.test.ts.
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

describe("TOOLS_FOR_ROLE", () => {
  it("gives cleaners status/leaderboard/properties only", () => {
    const names = TOOLS_FOR_ROLE.cleaner.map((t) => t.name);
    expect(names).toEqual(["get_my_status", "get_leaderboard", "get_properties"]);
  });

  it("gives admins leaderboard/properties/reviews-summary only", () => {
    const names = TOOLS_FOR_ROLE.admin.map((t) => t.name);
    expect(names).toEqual(["get_leaderboard", "get_properties", "get_reviews_summary"]);
  });

  it("uses the empty-object Anthropic input_schema shape for every tool", () => {
    for (const tool of [...TOOLS_FOR_ROLE.cleaner, ...TOOLS_FOR_ROLE.admin]) {
      expect(tool.input_schema).toEqual({ type: "object", properties: {} });
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

describe("runTool — cleaner role, in-scope", () => {
  it("get_my_status returns the calling cleaner's own status", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cleaner-1", "awesome");

    const result = await runTool("get_my_status", { db, role: "cleaner", userId: cleanerId });
    expect(result).toEqual({
      username: "cleaner-1",
      rank: "awesome",
      score: null,
      picks: [],
      slots_remaining: 3,
    });
  });

  it("get_leaderboard returns every cleaner ranked", async () => {
    const db = createConnection(":memory:");
    const legendId = insertCleaner(db, "legend-1", "legend");
    const normalId = insertCleaner(db, "normal-1", "normal");

    const result = (await runTool("get_leaderboard", {
      db,
      role: "cleaner",
      userId: legendId,
    })) as { cleaner_id: number; rank: string }[];
    const byId = new Map(result.map((e) => [e.cleaner_id, e]));
    expect(byId.get(legendId)?.rank).toBe("legend");
    expect(byId.get(normalId)?.rank).toBe("normal");
  });

  it("get_properties returns every property with owner or null", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cleaner-2", "awesome");
    const propertyId = insertProperty(db, "Sunset Villa");

    const result = (await runTool("get_properties", {
      db,
      role: "cleaner",
      userId: cleanerId,
    })) as { id: number; owner: string | null }[];
    const byId = new Map(result.map((p) => [p.id, p.owner]));
    expect(byId.get(propertyId)).toBeNull();
  });
});

describe("runTool — admin role, in-scope", () => {
  it("get_leaderboard works for admins too", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "admin-1", "admin");
    insertCleaner(db, "cleaner-3", "normal");

    const result = await runTool("get_leaderboard", { db, role: "admin", userId: adminId });
    expect(Array.isArray(result)).toBe(true);
  });

  it("get_properties works for admins too", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "admin-2", "admin");
    insertProperty(db, "Hilltop House");

    const result = await runTool("get_properties", { db, role: "admin", userId: adminId });
    expect(Array.isArray(result)).toBe(true);
  });

  it("get_reviews_summary returns period stats", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "admin-3", "admin");

    const result = await runTool("get_reviews_summary", { db, role: "admin", userId: adminId });
    expect(result).toEqual({
      period: null,
      total_reviews: 0,
      cleaners_reviewed: 0,
      average_stars: null,
    });
  });
});

describe("runTool — role-scoping boundary", () => {
  it("throws when a cleaner asks for get_reviews_summary", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cleaner-4", "awesome");

    await expect(
      runTool("get_reviews_summary", { db, role: "cleaner", userId: cleanerId }),
    ).rejects.toThrow();
  });

  it("throws when an admin asks for get_my_status", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "admin-4", "admin");

    await expect(
      runTool("get_my_status", { db, role: "admin", userId: adminId }),
    ).rejects.toThrow();
  });

  it("throws for an unknown tool name regardless of role", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cleaner-5", "normal");

    await expect(
      runTool("delete_everything", { db, role: "cleaner", userId: cleanerId }),
    ).rejects.toThrow();
  });
});
