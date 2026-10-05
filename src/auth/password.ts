import bcrypt from "bcryptjs";

// bcryptjs (pure JS) chosen over native `bcrypt`: avoids a second native
// addon build alongside better-sqlite3 in the Alpine/slim Docker image.
const SALT_ROUNDS = 10;

/** Hashes a plaintext password for storage in `users.password_hash`. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Checks a plaintext password against a stored hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
