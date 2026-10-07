// Anthropic tool-use schemas + role-scoped dispatch: epic.md "assistant"
// section and task 002. Wraps task 001's read-only query functions
// (src/api/cleaner.ts, src/api/admin.ts) as tools an LLM can call. No write
// tools exist anywhere in this file — the assistant is read-only Q&A.

import type Database from "better-sqlite3";
import { getMyStatus, getLeaderboard, getPropertiesList } from "../api/cleaner.ts";
import { getReviewsSummary } from "../api/admin.ts";

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

/** Which tools exist for each role. This is the role-scoping boundary — see `runTool`. */
export const TOOLS_FOR_ROLE: Record<"cleaner" | "admin", ToolSchema[]> = {
  cleaner: [GET_MY_STATUS, GET_LEADERBOARD, GET_PROPERTIES],
  admin: [GET_LEADERBOARD, GET_PROPERTIES, GET_REVIEWS_SUMMARY],
};

export interface RunToolContext {
  db: Database.Database;
  role: "cleaner" | "admin";
  userId: number;
}

/**
 * Dispatches a tool call by name, scoped strictly to `ctx.role`'s own tool
 * set (never the union of all four tools). An admin ctx must never be able
 * to call `get_my_status`, nor a cleaner ctx `get_reviews_summary`, even if
 * a crafted request asks for it directly.
 */
export async function runTool(name: string, ctx: RunToolContext): Promise<unknown> {
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
    default:
      // Unreachable: `allowed.some(...)` above already validated `name`
      // against this role's tool set, which only ever contains these four.
      throw new Error(`Unknown tool "${name}"`);
  }
}
