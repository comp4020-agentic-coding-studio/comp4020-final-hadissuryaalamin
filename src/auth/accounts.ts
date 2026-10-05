import type Database from "better-sqlite3";
import { hashPassword } from "./password.ts";

export interface CreateCleanerAccountInput {
  username: string;
  password: string;
}

export interface CreateCleanerAccountResult {
  user_id: number;
  username: string;
}

/**
 * Hashes the password and inserts a `users` row (role `cleaner`) plus its
 * matching `cleaners` row (default `rank` of `normal`), in one transaction.
 * Plain function, not an HTTP route — task 004's admin "create cleaner"
 * endpoint calls this. Throws (unique constraint) if the username is taken.
 */
export async function createCleanerAccount(
  db: Database.Database,
  input: CreateCleanerAccountInput,
): Promise<CreateCleanerAccountResult> {
  const passwordHash = await hashPassword(input.password);

  const insert = db.transaction((username: string, hash: string): number => {
    const result = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'cleaner')")
      .run(username, hash);
    const userId = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO cleaners (user_id) VALUES (?)").run(userId);
    return userId;
  });

  const userId = insert(input.username, passwordHash);
  return { user_id: userId, username: input.username };
}
