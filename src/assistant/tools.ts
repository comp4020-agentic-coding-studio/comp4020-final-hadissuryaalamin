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
import { getMyStatus, getLeaderboard, getPropertiesList, claimProperty, releaseProperty } from "../api/cleaner.ts";
import { getReviewsSummary, createProperty, applyReviewBatch, type ReviewBatchItem } from "../api/admin.ts";
import { createCleanerAccount } from "../auth/index.ts";
import { setProposal, getProposal, clearProposal } from "./proposals.ts";
import { parseReviewsCsv, parseCleanersCsv, parsePropertiesCsv } from "./csv.ts";
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

export const PROPOSE_REVIEW_BATCH_FROM_FILE: ToolSchema = {
  name: "propose_review_batch_from_file",
  description:
    "Parse an attached CSV (username,stars) into a review batch, matching usernames against existing cleaners, without submitting it yet. On success this stores a pending proposal the user must separately confirm; it always reads the file the user attached, never a filename or content given in the message text.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const PROPOSE_CREATE_CLEANERS_FROM_FILE: ToolSchema = {
  name: "propose_create_cleaners_from_file",
  description:
    "Parse an attached CSV (username,password) into a batch of new cleaner accounts, flagging any already-taken usernames, without creating them yet. On success this stores a pending proposal the user must separately confirm; it always reads the file the user attached, never a filename or content given in the message text.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const PROPOSE_CREATE_PROPERTIES_FROM_FILE: ToolSchema = {
  name: "propose_create_properties_from_file",
  description:
    "Parse an attached CSV (name,address) into a batch of new properties, without creating them yet. On success this stores a pending proposal the user must separately confirm; it always reads the file the user attached, never a filename or content given in the message text.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const EXECUTE_PENDING_ACTION: ToolSchema = {
  name: "execute_pending_action",
  description:
    "Carry out the single pending proposal stored for the current user (from a propose_* tool) and clear it. Returns \"Nothing pending to confirm.\" if there isn't one. Only call this after the user has explicitly confirmed the pending action's description.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

export const CANCEL_PENDING_ACTION: ToolSchema = {
  name: "cancel_pending_action",
  description: "Discard the pending proposal stored for the current user without carrying it out.",
  input_schema: EMPTY_INPUT_SCHEMA,
};

/** Which tools exist for each role. This is the role-scoping boundary — see `runTool`. */
export const TOOLS_FOR_ROLE: Record<"cleaner" | "admin", ToolSchema[]> = {
  cleaner: [
    GET_MY_STATUS,
    GET_LEADERBOARD,
    GET_PROPERTIES,
    PROPOSE_CLAIM_PROPERTY,
    PROPOSE_RELEASE_PROPERTY,
    EXECUTE_PENDING_ACTION,
    CANCEL_PENDING_ACTION,
  ],
  admin: [
    GET_LEADERBOARD,
    GET_PROPERTIES,
    GET_REVIEWS_SUMMARY,
    PROPOSE_REVIEW_BATCH_FROM_FILE,
    PROPOSE_CREATE_CLEANERS_FROM_FILE,
    PROPOSE_CREATE_PROPERTIES_FROM_FILE,
    EXECUTE_PENDING_ACTION,
    CANCEL_PENDING_ACTION,
  ],
};

export interface RunToolContext {
  db: Database.Database;
  role: "cleaner" | "admin";
  userId: number;
  /** The file the user attached to this message, if any. propose_*_from_file
   * tools read this directly -- never model-supplied input -- so a crafted
   * tool-call argument can never substitute its own CSV content. */
  attachedFile?: { name: string; content: string };
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

/** Joins up to `cap` names, appending a "+N more" suffix past that. */
function formatNameList(names: string[], cap = 10): string {
  if (names.length <= cap) return names.join(", ");
  return `${names.slice(0, cap).join(", ")}, +${names.length - cap} more`;
}

const NO_FILE_MESSAGE = "No file was attached. Attach a CSV and try again.";

/**
 * Parses `ctx.attachedFile` (never model input) as a `username,stars` CSV,
 * matching usernames against the current cleaner list, and stores a
 * `review_batch` proposal describing the parse result. Stores nothing (and
 * explains why) if no file was attached.
 */
function proposeReviewBatchFromFile(ctx: RunToolContext): string {
  if (!ctx.attachedFile) return NO_FILE_MESSAGE;

  const cleaners = getLeaderboard(ctx.db) as { cleaner_id: number; username: string }[];
  const { items, unknownUsernames } = parseReviewsCsv(ctx.attachedFile.content, cleaners);

  let description = `Submit ${items.length} review(s) from ${ctx.attachedFile.name}.`;
  if (unknownUsernames.length > 0) {
    description += ` Unknown username(s): ${formatNameList(unknownUsernames)}.`;
  }

  setProposal(ctx.userId, "review_batch", { items }, description);
  return description;
}

/**
 * Parses `ctx.attachedFile` (never model input) as a `username,password`
 * CSV, flagging usernames already taken in the `users` table, and stores a
 * `create_cleaners` proposal describing the parse result. Stores nothing
 * (and explains why) if no file was attached. Does not insert anything --
 * that's `execute_pending_action`'s job.
 */
function proposeCreateCleanersFromFile(ctx: RunToolContext): string {
  if (!ctx.attachedFile) return NO_FILE_MESSAGE;

  const { rows, invalidLines } = parseCleanersCsv(ctx.attachedFile.content);
  const existingUsernames = new Set(
    (ctx.db.prepare("SELECT username FROM users").all() as { username: string }[]).map((u) =>
      u.username.toLowerCase(),
    ),
  );
  const alreadyTaken = rows
    .filter((r) => existingUsernames.has(r.username.toLowerCase()))
    .map((r) => r.username);

  let description = `Create ${rows.length} cleaner account(s) from ${ctx.attachedFile.name}.`;
  if (alreadyTaken.length > 0) {
    description += ` Already-taken username(s): ${formatNameList(alreadyTaken)}.`;
  }
  if (invalidLines.length > 0) {
    description += ` Skipped ${invalidLines.length} invalid line(s).`;
  }

  setProposal(ctx.userId, "create_cleaners", { rows }, description);
  return description;
}

/**
 * Parses `ctx.attachedFile` (never model input) as a `name,address` CSV and
 * stores a `create_properties` proposal describing the parse result. Stores
 * nothing (and explains why) if no file was attached.
 */
function proposeCreatePropertiesFromFile(ctx: RunToolContext): string {
  if (!ctx.attachedFile) return NO_FILE_MESSAGE;

  const { rows, invalidLines } = parsePropertiesCsv(ctx.attachedFile.content);

  let description = `Create ${rows.length} propert${rows.length === 1 ? "y" : "ies"} from ${ctx.attachedFile.name}.`;
  if (invalidLines.length > 0) {
    description += ` Skipped ${invalidLines.length} invalid line(s).`;
  }

  setProposal(ctx.userId, "create_properties", { rows }, description);
  return description;
}

/** Plain confirmation/failure string for a `claimProperty` result. */
function claimResultMessage(
  db: Database.Database,
  result: { ok: true; pick: PickRow } | { ok: false; reason: string },
): string {
  if (result.ok) {
    const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(result.pick.property_id) as
      | PropertyRow
      | undefined;
    return `Claimed ${property?.name ?? `property ${result.pick.property_id}`}.`;
  }
  const messages: Record<string, string> = {
    forbidden: "You don't have a cleaner profile, so you can't claim a property.",
    "property-not-found": "That property no longer exists.",
    "no-free-slot": "You don't have a free slot to claim another property.",
    "already-claimed": "That property was claimed by someone else in the meantime.",
  };
  return messages[result.reason] ?? "Couldn't claim that property.";
}

/** Plain confirmation/failure string for a `releaseProperty` result. */
function releaseResultMessage(
  db: Database.Database,
  result: { ok: true; pick: PickRow } | { ok: false; reason: string },
): string {
  if (result.ok) {
    const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(result.pick.property_id) as
      | PropertyRow
      | undefined;
    return `Released ${property?.name ?? `property ${result.pick.property_id}`}.`;
  }
  const messages: Record<string, string> = {
    "not-found": "That claim no longer exists.",
    forbidden: "That claim doesn't belong to you.",
  };
  return messages[result.reason] ?? "Couldn't release that claim.";
}

/**
 * Carries out whatever is in `getProposal(ctx.userId)` -- the only code path
 * in this file that actually writes picks/reviews/cleaners/properties --
 * dispatching on the proposal's `type` across every kind a propose_* tool
 * can store. Always clears the slot before returning, on every branch
 * (including an unknown/missing type), so a stale or malformed entry can
 * never be executed twice. Returns "Nothing pending to confirm." if there
 * is no pending proposal.
 */
async function executePendingAction(ctx: RunToolContext): Promise<string> {
  const proposal = getProposal(ctx.userId);
  if (!proposal) return "Nothing pending to confirm.";

  try {
    switch (proposal.type) {
      case "claim_property": {
        const data = proposal.data as { propertyId: number };
        const result = claimProperty(ctx.db, ctx.userId, data.propertyId);
        return claimResultMessage(ctx.db, result);
      }
      case "release_property": {
        const data = proposal.data as { pickId: number };
        const result = releaseProperty(ctx.db, ctx.userId, data.pickId);
        return releaseResultMessage(ctx.db, result);
      }
      case "review_batch": {
        const data = proposal.data as { items: ReviewBatchItem[] };
        applyReviewBatch(ctx.db, data.items);
        return `Submitted ${data.items.length} review(s).`;
      }
      case "create_cleaners": {
        const data = proposal.data as { rows: { username: string; password: string }[] };
        let created = 0;
        const failed: string[] = [];
        for (const row of data.rows) {
          try {
            await createCleanerAccount(ctx.db, row);
            created++;
          } catch {
            failed.push(row.username);
          }
        }
        let message = `Created ${created} cleaner account(s).`;
        if (failed.length > 0) {
          message += ` Failed (duplicate username): ${formatNameList(failed)}.`;
        }
        return message;
      }
      case "create_properties": {
        const data = proposal.data as { rows: { name: string; address: string }[] };
        for (const row of data.rows) {
          createProperty(ctx.db, row.name, row.address);
        }
        return `Created ${data.rows.length} propert${data.rows.length === 1 ? "y" : "ies"}.`;
      }
      default:
        return "That pending action is no longer supported.";
    }
  } finally {
    clearProposal(ctx.userId);
  }
}

/** Discards the pending proposal for `ctx.userId`, if any, without carrying it out. */
function cancelPendingAction(ctx: RunToolContext): string {
  const hadProposal = getProposal(ctx.userId) !== undefined;
  clearProposal(ctx.userId);
  return hadProposal ? "Cancelled." : "Nothing was pending.";
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
    case "propose_review_batch_from_file":
      return proposeReviewBatchFromFile(ctx);
    case "propose_create_cleaners_from_file":
      return proposeCreateCleanersFromFile(ctx);
    case "propose_create_properties_from_file":
      return proposeCreatePropertiesFromFile(ctx);
    case "execute_pending_action":
      return executePendingAction(ctx);
    case "cancel_pending_action":
      return cancelPendingAction(ctx);
    default:
      // Unreachable: `allowed.some(...)` above already validated `name`
      // against this role's tool set.
      throw new Error(`Unknown tool "${name}"`);
  }
}
