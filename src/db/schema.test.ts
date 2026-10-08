import { describe, expect, it } from "vitest";
import { createConnection } from "./connection.ts";
import { migrate } from "./schema.ts";
import type { CleanerRow, PickRow, PropertyRow, ReviewRow, UserRow } from "./types.ts";

// Every test opens its own throwaway `:memory:` DB — no shared state, no
// file left behind, and migrate() runs as part of createConnection().
function freshDb() {
  return createConnection(":memory:");
}

describe("db schema", () => {
  it("creates all tables and is safe to migrate twice", () => {
    const db = freshDb();
    // sqlite_sequence is SQLite's own bookkeeping table for AUTOINCREMENT
    // columns, not one of ours — excluded rather than asserted on.
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "assistant_usage",
      "cleaners",
      "picks",
      "properties",
      "reviews",
      "users",
    ]);

    // Re-running migrate() against the same connection must be a no-op, not
    // an error (CREATE TABLE IF NOT EXISTS, same statements both times).
    expect(() => migrate(db)).not.toThrow();
  });

  it("round-trips a users row", () => {
    const db = freshDb();
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("alice", "hashed:pw", "cleaner");

    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(lastInsertRowid) as UserRow;

    expect(row).toEqual({
      id: Number(lastInsertRowid),
      username: "alice",
      password_hash: "hashed:pw",
      role: "cleaner",
    });
  });

  it("rejects a duplicate username", () => {
    const db = freshDb();
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(
      "bob",
      "hash1",
      "admin",
    );
    expect(() =>
      db
        .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
        .run("bob", "hash2", "cleaner"),
    ).toThrow();
  });

  it("round-trips a cleaners row, defaulted to rank 'normal'", () => {
    const db = freshDb();
    const { lastInsertRowid: userId } = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("cleaner-1", "hash", "cleaner");

    db.prepare("INSERT INTO cleaners (user_id) VALUES (?)").run(userId);

    const row = db
      .prepare("SELECT * FROM cleaners WHERE user_id = ?")
      .get(userId) as CleanerRow;

    expect(row).toEqual({ user_id: Number(userId), rank: "normal" });
  });

  it("round-trips a reviews row with an auto-populated created_at", () => {
    const db = freshDb();
    const { lastInsertRowid: userId } = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("cleaner-2", "hash", "cleaner");
    db.prepare("INSERT INTO cleaners (user_id) VALUES (?)").run(userId);

    const { lastInsertRowid: reviewId } = db
      .prepare("INSERT INTO reviews (cleaner_id, stars, period) VALUES (?, ?, ?)")
      .run(userId, 5, "2026-09");

    const row = db
      .prepare("SELECT * FROM reviews WHERE id = ?")
      .get(reviewId) as ReviewRow;

    expect(row.cleaner_id).toBe(Number(userId));
    expect(row.stars).toBe(5);
    expect(row.period).toBe("2026-09");
    expect(typeof row.created_at).toBe("string");
    expect(row.created_at.length).toBeGreaterThan(0);
  });

  it("rejects a stars value outside 1-5", () => {
    const db = freshDb();
    const { lastInsertRowid: userId } = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("cleaner-3", "hash", "cleaner");
    db.prepare("INSERT INTO cleaners (user_id) VALUES (?)").run(userId);

    expect(() =>
      db
        .prepare("INSERT INTO reviews (cleaner_id, stars, period) VALUES (?, ?, ?)")
        .run(userId, 6, "2026-09"),
    ).toThrow();
  });

  it("round-trips a properties row", () => {
    const db = freshDb();
    const { lastInsertRowid } = db
      .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
      .run("Sunset Villa", "1 Beach Rd");

    const row = db
      .prepare("SELECT * FROM properties WHERE id = ?")
      .get(lastInsertRowid) as PropertyRow;

    expect(row).toEqual({
      id: Number(lastInsertRowid),
      name: "Sunset Villa",
      address: "1 Beach Rd",
    });
  });

  it("round-trips a picks row and enforces its unique constraints", () => {
    const db = freshDb();
    const { lastInsertRowid: userId } = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("cleaner-4", "hash", "cleaner");
    db.prepare("INSERT INTO cleaners (user_id) VALUES (?)").run(userId);

    const { lastInsertRowid: propertyId } = db
      .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
      .run("Hilltop House", "2 Ridge Way");

    const { lastInsertRowid: pickId } = db
      .prepare("INSERT INTO picks (cleaner_id, property_id, slot) VALUES (?, ?, ?)")
      .run(userId, propertyId, 1);

    const row = db.prepare("SELECT * FROM picks WHERE id = ?").get(pickId) as PickRow;
    expect(row).toEqual({
      id: Number(pickId),
      cleaner_id: Number(userId),
      property_id: Number(propertyId),
      slot: 1,
    });

    // Same property claimed again (even by a different cleaner) must fail —
    // this is the uniqueness the API layer relies on for the 409 race rule.
    const { lastInsertRowid: otherUserId } = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("cleaner-5", "hash", "cleaner");
    db.prepare("INSERT INTO cleaners (user_id) VALUES (?)").run(otherUserId);
    expect(() =>
      db
        .prepare("INSERT INTO picks (cleaner_id, property_id, slot) VALUES (?, ?, ?)")
        .run(otherUserId, propertyId, 1),
    ).toThrow();

    // Same cleaner, same slot number twice must also fail.
    const { lastInsertRowid: anotherPropertyId } = db
      .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
      .run("Lakeside Cabin", "3 Water St");
    expect(() =>
      db
        .prepare("INSERT INTO picks (cleaner_id, property_id, slot) VALUES (?, ?, ?)")
        .run(userId, anotherPropertyId, 1),
    ).toThrow();
  });
});
