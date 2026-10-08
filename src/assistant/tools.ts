// Anthropic tool-use schemas + role-scoped dispatch: epic.md "assistant"
// section, task 002 (read-only tools) and task 003 (write-proposing tools).
// Wraps task 001's read-only query functions (src/api/cleaner.ts,
// src/api/admin.ts) as tools an LLM can call, plus the propose_* tools added
// in task 003: these validate a claim/release WITHOUT writing, and on
// success stash a human-readable description via setProposal (see
// ./proposals.ts) for the two-turn confirm flow. No tool in this file ever
// writes to picks directly -- execute_pending_action (task 004) is the only
// code path that does.

import type Database from "better-sqlite3";
import { getMyStatus, getLeaderboard, getPropertiesList } from "../api/cleaner.ts";
import { getReviewsSummary } from "../api/admin.ts";
import { setProposal } from "./proposals.ts";
import { capForRank } from "../ranking/index.ts";
import type { CleanerRow, PickRow, PropertyRow } from "../db/types.ts";

/** The `{ name, description, input_schema }` shape the Anthropic SDK's `tools` param expects. */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const EMPTY_INPUT_SCHEMA = { type: "object" as const, properties: {} };

export const GET_MY_STATUS: ToolSchema = {
  name: "get_my_status",
  description: "the current cleaner's own rank, score, claimed properties, and remaining slots.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const GET_LEADERBOARD: ToolSchema = {
  name: "get_leaderboard",
  description: "the full cleaner leaderboard ranked by tier and score.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const GET_PROPERTIES: ToolSchema = {
  name: "get_properties",
  description: "every property and who (if anyone) currently owns it.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const GET_REVIEWS_SUMMARY: ToolSchema = {
  name: "get_reviews_summary",
  description: "this period's review stats: count, how many cleaners reviewed, average stars.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const PROPOSE_CLAIM_PROPERTY: ToolSchema = {
  name: "propose_claim_property",
  description:
    "Validate claiming a property for the current cleaner (it must be unclaimed and the cleaner must have a free slot) without claiming it yet. On success this stores a pending proposal the user must separately confirm; on failure it explains why and stores nothing.",
  input_schema: {
    type: "object",
    properties: {
      property_id: { type: "integer", description: "The id of the property to claim." },
    },
    required: ["property_id"],
  },
};

export const PROPOSE_RELEASE_PROPERTY: ToolSchema = {
  name: "propose_release_property",
  description:
    "Validate releasing one of the current cleaner's own claimed properties without releasing it yet. On success this stores a pending proposal the user must separately confirm; on failure it explains why and stores nothing.",
  input_schema: {
    type: "object",
    properties: {
      pick_id: { type: "integer", description: "The id of the pick (claim) to release." },
    },
    required: ["pick_id"],
  },
};

/** Which tools exist for each role. This is the role-scoping boundary — see `runTool`. */
export const TOOLS_FOR_ROLE: Record<"cleaner" | "admin", ToolSchema[]> = {
  cleaner: [GET_MY_STATUS, GET_LEADERBOARD, GET_PROPERTIES, PROPOSE_CLAIM_PROPERTY, PROPOSE_RELEASE_PROPERTY],
  admin: [GET_LEADERBOARD, GET_PROPERTIES, GET_REVIEWS_SUMMARY],
};

export interface RunToolContext {
  db: Database.Database;
  role: "cleaner" | "admin";
  userId: number;
}

/**
 * Validates a claim for `ctx.userId` on `input.property_id` WITHOUT writing
 * anything -- same checks `claimProperty` (src/api/cleaner.ts) would hit, in
 * the same order, re-read here rather than imported so this never performs
 * the write `claimProperty` does. On success, stores a pending proposal
 * (see ./proposals.ts) and returns the same human-readable description the
 * model should relay back to the user asking for confirmation. On any
 * failure, returns a plain explanation and stores nothing.
 */
function proposeClaimProperty(ctx: RunToolContext, input: Record<string, unknown> | undefined): string {
  const { db, userId } = ctx;
  const propertyId = input?.property_id;
  if (typeof propertyId !== "number") {
    return "I need a valid property_id to propose a claim.";
  }

  const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(userId) as
    | CleanerRow
    | undefined;
  if (!cleaner) {
    return "You don't have a cleaner profile, so you can't claim a property.";
  }

  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(propertyId) as
    | PropertyRow
    | undefined;
  if (!property) {
    return `There's no property with id ${propertyId}.`;
  }

  const existingPick = db.prepare("SELECT 1 FROM picks WHERE property_id = ?").get(propertyId);
  if (existingPick) {
    return `${property.name} is already claimed by someone else.`;
  }

  const cap = capForRank(cleaner.rank);
  const existingPicks = db
    .prepare("SELECT slot FROM picks WHERE cleaner_id = ?")
    .all(userId) as { slot: number }[];
  if (existingPicks.length >= cap) {
    return "You don't have a free slot to claim another property.";
  }

  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as
    | { username: string }
    | undefined;
  const username = user?.username ?? `user ${userId}`;

  const description = `Claim ${property.name} at ${property.address} for ${username}.`;
  setProposal(userId, "claim_property", { propertyId }, description);
  return description;
}

/**
 * Validates releasing `input.pick_id` on behalf of `ctx.userId` WITHOUT
 * deleting anything -- same checks `releaseProperty` would hit. On success,
 * stores a pending proposal and returns its description; on failure,
 * returns a plain explanation and stores nothing.
 */
function proposeReleaseProperty(ctx: RunToolContext, input: Record<string, unknown> | undefined): string {
  const { db, userId } = ctx;
  const pickId = input?.pick_id;
  if (typeof pickId !== "number") {
    return "I need a valid pick_id to propose a release.";
  }

  const pick = db.prepare("SELECT * FROM picks WHERE id = ?").get(pickId) as PickRow | undefined;
  if (!pick) {
    return `There's no claim with id ${pickId}.`;
  }
  if (pick.cleaner_id !== userId) {
    return "That claim doesn't belong to you, so you can't release it.";
  }

  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(pick.property_id) as
    | PropertyRow
    | undefined;
  const propertyName = property?.name ?? `property ${pick.property_id}`;
  const propertyAddress = property?.address ?? "an unknown address";

  const description = `Release ${propertyName} at ${propertyAddress}.`;
  setProposal(userId, "release_property", { pickId }, description);
  return description;
}

/**
 * Dispatches a tool call by name, scoped strictly to `ctx.role`'s own tool
 * set (never the union of all tools). An admin ctx must never be able to
 * call `get_my_status`, nor a cleaner ctx `get_reviews_summary`, even if a
 * crafted request asks for it directly. `input` is the model's tool-call
 * arguments (unused by the read-only tools, required by the propose_* ones).
 */
export async function runTool(
  name: string,
  ctx: RunToolContext,
  input?: Record<string, unknown>,
): Promise<unknown> {
  const allowed = TOOLS_FOR_ROLE[ctx.role];
  if (!allowed.some((tool) => tool.name === name)) {
    throw new Error(`Tool "${name}" is not available for role "${ctx.role}"`);
  }

  switch (name) {
    case "get_my_status":
      return getMyStatus(ctx.db, ctx.userId);
    case "get_leaderboard":
      return getLeaderboard(ctx.db);
    case "get_properties":
      return getPropertiesList(ctx.db);
    case "get_reviews_summary":
      return getReviewsSummary(ctx.db);
    case "propose_claim_property":
      return proposeClaimProperty(ctx, input);
    case "propose_release_property":
      return proposeReleaseProperty(ctx, input);
    default:
      // Unreachable: `allowed.some(...)` above already validated `name`
      // against this role's tool set.
      throw new Error(`Unknown tool "${name}"`);
  }
}
