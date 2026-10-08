import { describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.ts";
import { getUsageSummary, recordUsage } from "./usage.ts";

// Every test opens its own throwaway `:memory:` DB — migrate() runs as part
// of createConnection() (see src/db/schema.test.ts).
function freshDb() {
  return createConnection(":memory:");
}

function insertUser(db: ReturnType<typeof freshDb>, username: string): number {
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, "hash", "cleaner");
  return Number(result.lastInsertRowid);
}

describe("assistant usage tracking", () => {
  it("reports zero totals and since: null when no usage has been recorded", () => {
    const db = freshDb();

    expect(getUsageSummary(db)).toEqual({
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      since: null,
    });
  });

  it("accumulates totals across several rows from different users", () => {
    const db = freshDb();
    const alice = insertUser(db, "alice");
    const bob = insertUser(db, "bob");

    recordUsage(db, { userId: alice, inputTokens: 100, outputTokens: 20 });
    recordUsage(db, { userId: bob, inputTokens: 50, outputTokens: 10 });
    recordUsage(db, { userId: alice, inputTokens: 30, outputTokens: 5 });

    const summary = getUsageSummary(db);
    expect(summary.totalRequests).toBe(3);
    expect(summary.totalInputTokens).toBe(180);
    expect(summary.totalOutputTokens).toBe(35);
  });

  it("reports since as the earliest row's created_at", () => {
    const db = freshDb();
    const userId = insertUser(db, "carol");

    recordUsage(db, { userId, inputTokens: 10, outputTokens: 2 });

    // Back-date the first row so it's unambiguously earliest, then record a
    // second row with the real (later) default timestamp.
    db.prepare(
      "UPDATE assistant_usage SET created_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ?",
    ).run(userId);
    recordUsage(db, { userId, inputTokens: 5, outputTokens: 1 });

    const summary = getUsageSummary(db);
    expect(summary.totalRequests).toBe(2);
    expect(summary.since).toBe("2020-01-01T00:00:00.000Z");
  });
});
