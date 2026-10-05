import { describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.ts";
import { seedAdminIfMissing } from "./seed.ts";

describe("seedAdminIfMissing", () => {
  it("creates an admin from env vars when none exists", async () => {
    const db = createConnection(":memory:");
    const result = await seedAdminIfMissing(db, {
      SEED_ADMIN_USERNAME: "root",
      SEED_ADMIN_PASSWORD: "s3cret",
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({ seeded: true, username: "root" });
    const admin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get() as { username: string } | undefined;
    expect(admin?.username).toBe("root");
  });

  it("is a no-op if an admin already exists", async () => {
    const db = createConnection(":memory:");
    await seedAdminIfMissing(db, { SEED_ADMIN_USERNAME: "root", SEED_ADMIN_PASSWORD: "s3cret" } as NodeJS.ProcessEnv);

    const second = await seedAdminIfMissing(db, {
      SEED_ADMIN_USERNAME: "other",
      SEED_ADMIN_PASSWORD: "x",
    } as NodeJS.ProcessEnv);

    expect(second.seeded).toBe(false);
    const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
    expect(admins).toHaveLength(1);
  });

  it("does nothing if env vars are missing", async () => {
    const db = createConnection(":memory:");
    const result = await seedAdminIfMissing(db, {} as NodeJS.ProcessEnv);
    expect(result.seeded).toBe(false);
    const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
    expect(admins).toHaveLength(0);
  });
});
