// Leaderboard: epic.md "Ranking (leaderboard)" section.

import { computeScore } from "./score.ts";
import type { CleanerForLeaderboard, LeaderboardEntry, Rank } from "./types.ts";

const LEGEND_SLOTS = 15;
const AWESOME_SLOTS = 10;

/**
 * Ranks cleaners into legend/awesome/normal tiers.
 *
 * `cleaners[].reviews` is expected to already be filtered to each cleaner's
 * active period (see activePeriod in score.ts) — this function doesn't know
 * about periods, only about scoring and ordering.
 *
 * Eligible (score !== null) cleaners are sorted descending by score,
 * tie-broken descending by review count, then by cleaner id ascending
 * (stable, deterministic). Top 15 -> legend, next 10 -> awesome, the rest
 * (and every ineligible cleaner) -> normal.
 */
export function computeLeaderboard(
  cleaners: CleanerForLeaderboard[],
): LeaderboardEntry[] {
  const scored = cleaners.map((c) => ({
    cleanerId: c.cleanerId,
    reviewCount: c.reviews.length,
    score: computeScore(c.reviews),
  }));

  const eligible = scored.filter((c) => c.score !== null);
  const ineligible = scored.filter((c) => c.score === null);

  eligible.sort((a, b) => {
    if (b.score !== a.score) return (b.score as number) - (a.score as number);
    if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
    return a.cleanerId - b.cleanerId;
  });

  const ranked: LeaderboardEntry[] = eligible.map((c, i) => ({
    cleanerId: c.cleanerId,
    rank: rankForPosition(i),
  }));

  const normal: LeaderboardEntry[] = ineligible.map((c) => ({
    cleanerId: c.cleanerId,
    rank: "normal",
  }));

  return [...ranked, ...normal];
}

function rankForPosition(index: number): Rank {
  if (index < LEGEND_SLOTS) return "legend";
  if (index < LEGEND_SLOTS + AWESOME_SLOTS) return "awesome";
  return "normal";
}

/** legend -> 5, awesome -> 3, normal -> 0 preferred-property slots. */
export function capForRank(rank: Rank): number {
  switch (rank) {
    case "legend":
      return 5;
    case "awesome":
      return 3;
    case "normal":
      return 0;
  }
}
