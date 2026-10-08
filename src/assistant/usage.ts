// Assistant token-usage tracking: epic.md "Usage tracking" section and task
// 002. One row per assistant request, written after each call to the model;
// read back as an aggregate summary. No per-user breakdown is required by
// the spec — just totals and the earliest timestamp on record.

import type Database from "better-sqlite3";

export interface RecordUsageArgs {
  userId: number;
  inputTokens: number;
  outputTokens: number;
}

/** Inserts one usage row for a single assistant request. */
export function recordUsage(db: Database.Database, args: RecordUsageArgs): void {
  db.prepare(
    "INSERT INTO assistant_usage (user_id, input_tokens, output_tokens) VALUES (?, ?, ?)",
  ).run(args.userId, args.inputTokens, args.outputTokens);
}

export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Earliest `created_at` across all rows, or `null` if none recorded yet. */
  since: string | null;
}

/** Aggregates every recorded row. Empty table gives all-zero totals and `since: null`. */
export function getUsageSummary(db: Database.Database): UsageSummary {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS totalRequests,
         COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
         COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
         MIN(created_at) AS since
       FROM assistant_usage`,
    )
    .get() as {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    since: string | null;
  };

  return {
    totalRequests: row.totalRequests,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    since: row.since,
  };
}
