// Local, minimal shapes for ranking math. Deliberately not tied to the
// better-sqlite3 row shapes in src/db/types.ts — these functions are pure
// over plain data, and the caller (tasks 004/005) maps DB rows into these.

import type { Rank } from "../db/types.ts";

export type { Rank };

/** One review's star rating. Used by computeScore, which already assumes
 * the caller has filtered to the active period (see activePeriod). */
export interface ScoredReview {
  stars: number;
}

/** One review with its period, as stored. Used by activePeriod to work out
 * which period is current and filter down to it. */
export interface PeriodedReview {
  stars: number;
  /** "YYYY-MM", compared lexicographically — this format sorts correctly
   * as a string, so no date parsing is needed. */
  period: string;
}

/** One cleaner's id plus their reviews for the active period, as input to
 * computeLeaderboard. */
export interface CleanerForLeaderboard {
  cleanerId: number;
  reviews: ScoredReview[];
}

export interface LeaderboardEntry {
  cleanerId: number;
  rank: Rank;
}

/** One of a cleaner's existing preferred-property picks, as input to
 * slotsToDrop. */
export interface PickSlot {
  slot: number;
}
