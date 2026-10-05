import { describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.ts";
import { createCleanerAccount } from "./accounts.ts";
import { verifyPassword } from "./password.ts";

describe("createCleanerAccount", () => {
  it("inserts a users row and a cleaners row, hashing the password", async () => {
    const db = createConnection(":memory:");
    const result = await createCleanerAccount(db, { username: "alice", password: "hunter2" });

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.user_id) as
      | { role: string; password_hash: string }
      | undefined;
    const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(result.user_id) as
      | { rank: string }
      | undefined;

    expect(user?.role).toBe("cleaner");
    expect(cleaner?.rank).toBe("normal");
    await expect(verifyPassword("hunter2", user!.password_hash)).resolves.toBe(true);
  });

  it("rejects a duplicate username", async () => {
    const db = createConnection(":memory:");
    await createCleanerAccount(db, { username: "bob", password: "pw" });
    await expect(createCleanerAccount(db, { username: "bob", password: "pw2" })).rejects.toThrow();
  });
});
