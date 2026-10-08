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
import { getProposal, clearProposal } from "./proposals.ts";

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
  it("gives cleaners status/leaderboard/properties/propose-claim/propose-release", () => {
    const names = TOOLS_FOR_ROLE.cleaner.map((t) => t.name);
    expect(names).toEqual([
      "get_my_status",
      "get_leaderboard",
      "get_properties",
      "propose_claim_property",
      "propose_release_property",
    ]);
  });

  it("gives admins leaderboard/properties/reviews-summary only", () => {
    const names = TOOLS_FOR_ROLE.admin.map((t) => t.name);
    expect(names).toEqual(["get_leaderboard", "get_properties", "get_reviews_summary"]);
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
