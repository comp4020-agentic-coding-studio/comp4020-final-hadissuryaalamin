// Ranking & scoring engine — public entry point. Pure logic, no HTTP; see
// tasks 004/005 for the route handlers that call these.

export { activePeriod, computeScore } from "./score.ts";
export { capForRank, computeLeaderboard } from "./leaderboard.ts";
export { slotsToDrop } from "./picks.ts";
export type {
  CleanerForLeaderboard,
  LeaderboardEntry,
  PeriodedReview,
  PickSlot,
  Rank,
  ScoredReview,
} from "./types.ts";
