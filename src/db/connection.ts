import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrate } from "./schema.ts";

/**
 * Where the DB file lives. `DB_PATH` wins outright (useful for tests and for
 * pointing at `:memory:`); otherwise `DATA_DIR` (the Fly volume mount in
 * prod, `/data`) joined with `app.db`; otherwise a local `./data/app.db` for
 * dev when neither env var is set.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DB_PATH) return env.DB_PATH;
  const dataDir = env.DATA_DIR ?? join(process.cwd(), "data");
  return join(dataDir, "app.db");
}

/** Opens (creating the directory and file if needed) and migrates a DB. */
export function createConnection(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
