import type Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.ts";
import type { Role } from "../db/types.ts";
import {
  runTool,
  TOOLS_FOR_ROLE,
  GET_MY_STATUS,
  GET_LEADERBOARD,
  GET_PROPERTIES,
  GET_REVIEWS_SUMMARY,
  PROPOSE_CLAIM_PROPERTY,
  PROPOSE_RELEASE_PROPERTY,
} from "./tools.ts";
import { getProposal, clearProposal, setProposal } from "./proposals.ts";

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

function insertPick(db: Database.Database, cleanerId: number, propertyId: number, slot = 1): number {
  const result = db
    .prepare("INSERT INTO picks (cleaner_id, property_id, slot) VALUES (?, ?, ?)")
    .run(cleanerId, propertyId, slot);
  return Number(result.lastInsertRowid);
}

describe("TOOLS_FOR_ROLE", () => {
  it("gives cleaners status/leaderboard/properties/propose-claim/propose-release/execute/cancel", () => {
    const names = TOOLS_FOR_ROLE.cleaner.map((t) => t.name);
    expect(names).toEqual([
      "get_my_status",
      "get_leaderboard",
      "get_properties",
      "propose_claim_property",
      "propose_release_property",
      "execute_pending_action",
      "cancel_pending_action",
    ]);
  });

  it("gives admins leaderboard/properties/reviews-summary/propose-from-file/execute/cancel", () => {
    const names = TOOLS_FOR_ROLE.admin.map((t) => t.name);
    expect(names).toEqual([
      "get_leaderboard",
      "get_properties",
      "get_reviews_summary",
      "propose_review_batch_from_file",
      "propose_create_cleaners_from_file",
      "propose_create_properties_from_file",
      "execute_pending_action",
      "cancel_pending_action",
    ]);
  });

  it("uses the empty-object Anthropic input_schema shape for every read-only tool", () => {
    for (const tool of [GET_MY_STATUS, GET_LEADERBOARD, GET_PROPERTIES, GET_REVIEWS_SUMMARY]) {
      expect(tool.input_schema).toEqual({ type: "object", properties: {} });
    }
  });

  it("every tool has a non-empty description", () => {
    for (const tool of [...TOOLS_FOR_ROLE.cleaner, ...TOOLS_FOR_ROLE.admin]) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("propose_claim_property requires an integer property_id", () => {
    expect(PROPOSE_CLAIM_PROPERTY.input_schema.required).toEqual(["property_id"]);
    expect(PROPOSE_CLAIM_PROPERTY.input_schema.properties.property_id).toMatchObject({ type: "integer" });
  });

  it("propose_release_property requires an integer pick_id", () => {
    expect(PROPOSE_RELEASE_PROPERTY.input_schema.required).toEqual(["pick_id"]);
    expect(PROPOSE_RELEASE_PROPERTY.input_schema.properties.pick_id).toMatchObject({ type: "integer" });
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

describe("runTool — propose_claim_property", () => {
  it("stores a proposal and returns its description on success", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "claim-tool-1", "awesome");
    const propertyId = insertProperty(db, "Sunset Villa");
    clearProposal(cleanerId);

    const result = await runTool(
      "propose_claim_property",
      { db, role: "cleaner", userId: cleanerId },
      { property_id: propertyId },
    );

    expect(typeof result).toBe("string");
    expect(result as string).toContain("Sunset Villa");
    expect(result as string).toContain("claim-tool-1");
    expect(getProposal(cleanerId)).toEqual({
      type: "claim_property",
      data: { propertyId },
      description: result,
    });
  });

  it("explains and stores nothing when property_id is missing/invalid", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "claim-tool-2", "awesome");
    clearProposal(cleanerId);

    const result = await runTool("propose_claim_property", { db, role: "cleaner", userId: cleanerId }, {});
    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("explains and stores nothing when the property doesn't exist", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "claim-tool-3", "awesome");
    clearProposal(cleanerId);

    const result = await runTool(
      "propose_claim_property",
      { db, role: "cleaner", userId: cleanerId },
      { property_id: 9999 },
    );
    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("explains and stores nothing when the property is already claimed", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "claim-tool-4a", "awesome");
    const otherCleanerId = insertCleaner(db, "claim-tool-4b", "awesome");
    const propertyId = insertProperty(db, "Contested Villa");
    insertPick(db, otherCleanerId, propertyId, 1);
    clearProposal(cleanerId);

    const result = await runTool(
      "propose_claim_property",
      { db, role: "cleaner", userId: cleanerId },
      { property_id: propertyId },
    );
    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("explains and stores nothing when the cleaner has no free slot", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "claim-tool-5", "normal"); // cap 0
    const propertyId = insertProperty(db, "Lakeside Cabin");
    clearProposal(cleanerId);

    const result = await runTool(
      "propose_claim_property",
      { db, role: "cleaner", userId: cleanerId },
      { property_id: propertyId },
    );
    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("explains and stores nothing when the caller has no cleaner profile", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "claim-tool-admin", "admin");
    const propertyId = insertProperty(db, "No Profile House");
    clearProposal(adminId);

    const result = await runTool(
      "propose_claim_property",
      { db, role: "cleaner", userId: adminId },
      { property_id: propertyId },
    );
    expect(typeof result).toBe("string");
    expect(getProposal(adminId)).toBeUndefined();
  });
});

describe("runTool — propose_release_property", () => {
  it("stores a proposal and returns its description on success", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "release-tool-1", "awesome");
    const propertyId = insertProperty(db, "Hilltop House");
    const pickId = insertPick(db, cleanerId, propertyId, 1);
    clearProposal(cleanerId);

    const result = await runTool(
      "propose_release_property",
      { db, role: "cleaner", userId: cleanerId },
      { pick_id: pickId },
    );

    expect(typeof result).toBe("string");
    expect(result as string).toContain("Hilltop House");
    expect(getProposal(cleanerId)).toEqual({
      type: "release_property",
      data: { pickId },
      description: result,
    });
  });

  it("explains and stores nothing when pick_id is missing/invalid", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "release-tool-2", "awesome");
    clearProposal(cleanerId);

    const result = await runTool("propose_release_property", { db, role: "cleaner", userId: cleanerId }, {});
    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("explains and stores nothing when the pick doesn't exist", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "release-tool-3", "awesome");
    clearProposal(cleanerId);

    const result = await runTool(
      "propose_release_property",
      { db, role: "cleaner", userId: cleanerId },
      { pick_id: 9999 },
    );
    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("explains and stores nothing when the pick belongs to another cleaner", async () => {
    const db = createConnection(":memory:");
    const owner = insertCleaner(db, "release-tool-4a", "awesome");
    const other = insertCleaner(db, "release-tool-4b", "awesome");
    const propertyId = insertProperty(db, "Not Yours House");
    const pickId = insertPick(db, owner, propertyId, 1);
    clearProposal(other);

    const result = await runTool(
      "propose_release_property",
      { db, role: "cleaner", userId: other },
      { pick_id: pickId },
    );
    expect(typeof result).toBe("string");
    expect(getProposal(other)).toBeUndefined();
  });
});

describe("runTool — propose_review_batch_from_file", () => {
  it("explains and stores nothing when no file is attached", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "file-reviews-admin-1", "admin");
    clearProposal(adminId);

    const result = await runTool("propose_review_batch_from_file", { db, role: "admin", userId: adminId });
    expect(typeof result).toBe("string");
    expect(getProposal(adminId)).toBeUndefined();
  });

  it("parses the attached CSV and stores a review_batch proposal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "file-reviews-admin-2", "admin");
    const cleanerId = insertCleaner(db, "csv-cleaner-1", "normal");
    clearProposal(adminId);

    const result = await runTool(
      "propose_review_batch_from_file",
      {
        db,
        role: "admin",
        userId: adminId,
        attachedFile: { name: "reviews.csv", content: "username,stars\ncsv-cleaner-1,5\nghost,3" },
      },
    );

    expect(typeof result).toBe("string");
    expect(result as string).toContain("reviews.csv");
    expect(result as string).toContain("ghost");
    expect(getProposal(adminId)).toEqual({
      type: "review_batch",
      data: { items: [{ cleaner_id: cleanerId, stars: 5 }] },
      description: result,
    });
  });
});

describe("runTool — propose_create_cleaners_from_file", () => {
  it("explains and stores nothing when no file is attached", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "file-cleaners-admin-1", "admin");
    clearProposal(adminId);

    const result = await runTool("propose_create_cleaners_from_file", { db, role: "admin", userId: adminId });
    expect(typeof result).toBe("string");
    expect(getProposal(adminId)).toBeUndefined();
  });

  it("parses the attached CSV, flags already-taken usernames, and stores a create_cleaners proposal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "file-cleaners-admin-2", "admin");
    insertUser(db, "taken-name", "cleaner");
    clearProposal(adminId);

    const result = await runTool(
      "propose_create_cleaners_from_file",
      {
        db,
        role: "admin",
        userId: adminId,
        attachedFile: { name: "cleaners.csv", content: "username,password\nnew-cleaner,pw1\ntaken-name,pw2" },
      },
    );

    expect(typeof result).toBe("string");
    expect(result as string).toContain("taken-name");
    expect(getProposal(adminId)).toEqual({
      type: "create_cleaners",
      data: {
        rows: [
          { username: "new-cleaner", password: "pw1" },
          { username: "taken-name", password: "pw2" },
        ],
      },
      description: result,
    });
  });
});

describe("runTool — propose_create_properties_from_file", () => {
  it("explains and stores nothing when no file is attached", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "file-properties-admin-1", "admin");
    clearProposal(adminId);

    const result = await runTool("propose_create_properties_from_file", { db, role: "admin", userId: adminId });
    expect(typeof result).toBe("string");
    expect(getProposal(adminId)).toBeUndefined();
  });

  it("parses the attached CSV and stores a create_properties proposal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "file-properties-admin-2", "admin");
    clearProposal(adminId);

    const result = await runTool(
      "propose_create_properties_from_file",
      {
        db,
        role: "admin",
        userId: adminId,
        attachedFile: { name: "properties.csv", content: "name,address\nSunset Villa,1 Beach Rd" },
      },
    );

    expect(typeof result).toBe("string");
    expect(result as string).toContain("properties.csv");
    expect(getProposal(adminId)).toEqual({
      type: "create_properties",
      data: { rows: [{ name: "Sunset Villa", address: "1 Beach Rd" }] },
      description: result,
    });
  });
});

describe("runTool — propose_*_from_file role-scoping", () => {
  it("a cleaner ctx cannot reach any propose_*_from_file tool", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "scoped-cleaner-1", "awesome");

    for (const name of [
      "propose_review_batch_from_file",
      "propose_create_cleaners_from_file",
      "propose_create_properties_from_file",
    ]) {
      await expect(runTool(name, { db, role: "cleaner", userId: cleanerId })).rejects.toThrow();
    }
  });

  it("an admin ctx cannot reach propose_claim_property or propose_release_property", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "scoped-admin-1", "admin");

    await expect(
      runTool("propose_claim_property", { db, role: "admin", userId: adminId }, { property_id: 1 }),
    ).rejects.toThrow();
    await expect(
      runTool("propose_release_property", { db, role: "admin", userId: adminId }, { pick_id: 1 }),
    ).rejects.toThrow();
  });
});

describe("runTool — execute_pending_action", () => {
  it("returns 'Nothing pending to confirm.' when there is no proposal", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "exec-none", "awesome");
    clearProposal(cleanerId);

    const result = await runTool("execute_pending_action", { db, role: "cleaner", userId: cleanerId });
    expect(result).toBe("Nothing pending to confirm.");
  });

  it("claim_property: claims the property and clears the proposal", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "exec-claim", "awesome");
    const propertyId = insertProperty(db, "Exec Claim Villa");
    setProposal(cleanerId, "claim_property", { propertyId }, "Claim Exec Claim Villa.");

    const result = await runTool("execute_pending_action", { db, role: "cleaner", userId: cleanerId });

    expect(result as string).toContain("Exec Claim Villa");
    const pick = db.prepare("SELECT * FROM picks WHERE cleaner_id = ? AND property_id = ?").get(cleanerId, propertyId);
    expect(pick).toBeDefined();
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("claim_property: clears the proposal even when the claim now fails", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "exec-claim-fail", "awesome");
    const otherCleanerId = insertCleaner(db, "exec-claim-fail-other", "awesome");
    const propertyId = insertProperty(db, "Already Taken Villa");
    insertPick(db, otherCleanerId, propertyId, 1);
    setProposal(cleanerId, "claim_property", { propertyId }, "Claim Already Taken Villa.");

    const result = await runTool("execute_pending_action", { db, role: "cleaner", userId: cleanerId });

    expect(typeof result).toBe("string");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("release_property: releases the pick and clears the proposal", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "exec-release", "awesome");
    const propertyId = insertProperty(db, "Exec Release House");
    const pickId = insertPick(db, cleanerId, propertyId, 1);
    setProposal(cleanerId, "release_property", { pickId }, "Release Exec Release House.");

    const result = await runTool("execute_pending_action", { db, role: "cleaner", userId: cleanerId });

    expect(result as string).toContain("Exec Release House");
    const pick = db.prepare("SELECT * FROM picks WHERE id = ?").get(pickId);
    expect(pick).toBeUndefined();
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("review_batch: inserts the reviews and clears the proposal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "exec-review-admin", "admin");
    const cleanerId = insertCleaner(db, "exec-review-cleaner", "normal");
    setProposal(adminId, "review_batch", { items: [{ cleaner_id: cleanerId, stars: 5 }] }, "Submit 1 review(s).");

    const result = await runTool("execute_pending_action", { db, role: "admin", userId: adminId });

    expect(result).toBe("Submitted 1 review(s).");
    const reviews = db.prepare("SELECT * FROM reviews WHERE cleaner_id = ?").all(cleanerId);
    expect(reviews).toHaveLength(1);
    expect(getProposal(adminId)).toBeUndefined();
  });

  it("create_cleaners: creates each row, collects duplicates as failures, and clears the proposal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "exec-create-cleaners-admin", "admin");
    insertUser(db, "dup-cleaner", "cleaner");
    setProposal(
      adminId,
      "create_cleaners",
      {
        rows: [
          { username: "fresh-cleaner", password: "pw1" },
          { username: "dup-cleaner", password: "pw2" },
        ],
      },
      "Create 2 cleaner account(s).",
    );

    const result = await runTool("execute_pending_action", { db, role: "admin", userId: adminId });

    expect(result as string).toContain("Created 1 cleaner account(s).");
    expect(result as string).toContain("dup-cleaner");
    const freshRow = db.prepare("SELECT * FROM users WHERE username = ?").get("fresh-cleaner");
    expect(freshRow).toBeDefined();
    expect(getProposal(adminId)).toBeUndefined();
  });

  it("create_properties: creates each row and clears the proposal", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "exec-create-properties-admin", "admin");
    setProposal(
      adminId,
      "create_properties",
      { rows: [{ name: "Exec New Villa", address: "9 New Rd" }] },
      "Create 1 property.",
    );

    const result = await runTool("execute_pending_action", { db, role: "admin", userId: adminId });

    expect(result).toBe("Created 1 property.");
    const row = db.prepare("SELECT * FROM properties WHERE name = ?").get("Exec New Villa");
    expect(row).toBeDefined();
    expect(getProposal(adminId)).toBeUndefined();
  });

  it("clears an unknown/malformed proposal type without throwing", async () => {
    const db = createConnection(":memory:");
    const adminId = insertUser(db, "exec-unknown-admin", "admin");
    setProposal(adminId, "something_weird", {}, "Weird proposal.");

    const result = await runTool("execute_pending_action", { db, role: "admin", userId: adminId });

    expect(typeof result).toBe("string");
    expect(getProposal(adminId)).toBeUndefined();
  });
});

describe("runTool — cancel_pending_action", () => {
  it("cancels a pending proposal", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cancel-1", "awesome");
    const propertyId = insertProperty(db, "Cancel Villa");
    setProposal(cleanerId, "claim_property", { propertyId }, "Claim Cancel Villa.");

    const result = await runTool("cancel_pending_action", { db, role: "cleaner", userId: cleanerId });

    expect(result).toBe("Cancelled.");
    expect(getProposal(cleanerId)).toBeUndefined();
  });

  it("reports nothing to cancel when there is no pending proposal", async () => {
    const db = createConnection(":memory:");
    const cleanerId = insertCleaner(db, "cancel-2", "awesome");
    clearProposal(cleanerId);

    const result = await runTool("cancel_pending_action", { db, role: "cleaner", userId: cleanerId });

    expect(result).toBe("Nothing was pending.");
  });
});
