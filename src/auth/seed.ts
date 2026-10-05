import type Database from "better-sqlite3";
import { hashPassword } from "./password.ts";

export interface SeedAdminResult {
  seeded: boolean;
  username?: string;
}

/**
 * Creates the admin account from `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`
 * if no admin exists yet. Safe to call on every boot: a no-op once an admin
 * row is present, and a no-op (not an error) if the env vars are unset so a
 * dev box without them still boots. Never hardcodes a password.
 */
export async function seedAdminIfMissing(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedAdminResult> {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existingAdmin) {
    return { seeded: false };
  }

  const username = env.SEED_ADMIN_USERNAME;
  const password = env.SEED_ADMIN_PASSWORD;
  if (!username || !password) {
    return { seeded: false };
  }

  const passwordHash = await hashPassword(password);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, passwordHash);
  return { seeded: true, username };
}
