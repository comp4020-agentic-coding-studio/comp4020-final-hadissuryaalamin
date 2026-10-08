import type Database from "better-sqlite3";

// Single idempotent migration script, run at startup (and by every test that
// opens a connection). No migration framework — the data model is small and
// fixed per epic.md; this is the whole history.
//
// Table shapes come from epic.md's "Data model" section:
// - users: id, username (unique), password_hash, role (admin|cleaner)
// - cleaners: user_id (FK -> users.id), rank (legend|awesome|normal, default normal)
// - reviews: id, cleaner_id (FK), stars (1-5), period (YYYY-MM), created_at
// - properties: id, name, address
// - picks: id, cleaner_id (FK), property_id (FK, unique), slot (1-5, unique per cleaner_id)
// - assistant_usage: id, user_id (FK -> users.id), input_tokens, output_tokens, created_at
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'cleaner'))
  )`,
  `CREATE TABLE IF NOT EXISTS cleaners (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    rank TEXT NOT NULL DEFAULT 'normal' CHECK (rank IN ('legend', 'awesome', 'normal'))
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cleaner_id INTEGER NOT NULL REFERENCES cleaners(user_id),
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    period TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_cleaner_period ON reviews(cleaner_id, period)`,
  `CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cleaner_id INTEGER NOT NULL REFERENCES cleaners(user_id),
    property_id INTEGER NOT NULL UNIQUE REFERENCES properties(id),
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
    UNIQUE (cleaner_id, slot)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
];

/** Runs every CREATE TABLE/INDEX statement. Safe to call repeatedly. */
export function migrate(db: Database.Database): void {
  const run = db.transaction(() => {
    for (const statement of MIGRATIONS) {
      db.exec(statement);
    }
  });
  run();
}
