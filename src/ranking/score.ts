// Scoring: epic.md "Scoring" and "Review cycle" sections.

import type { PeriodedReview, ScoredReview } from "./types.ts";

/**
 * Restricts a cleaner's reviews to their active period: `max(period)` across
 * all of them. Older periods are kept in the DB for history but excluded
 * from the live score, so this must run before computeScore.
 *
 * Period strings are "YYYY-MM", which sort correctly lexicographically —
 * no date parsing needed.
 */
export function activePeriod(reviews: PeriodedReview[]): PeriodedReview[] {
  if (reviews.length === 0) return [];
  const current = reviews.reduce(
    (max, r) => (r.period > max ? r.period : max),
    reviews[0].period,
  );
  return reviews.filter((r) => r.period === current);
}

/**
 * A cleaner needs >= 5 reviews in the active period to be scored at all;
 * fewer than that returns null (forced `normal`, regardless of star
 * values). Otherwise the single lowest-star review is dropped entirely
 * (always exactly one drop, however many reviews beyond 5), and the rest
 * are averaged out of 5 — no /10 scaling.
 *
 * Callers are expected to have already filtered `reviews` down to the
 * active period (see activePeriod) — this function does not look at
 * period at all.
 */
export function computeScore(reviews: ScoredReview[]): number | null {
  if (reviews.length < 5) return null;

  const stars = reviews.map((r) => r.stars);
  const lowestIndex = stars.reduce(
    (lowest, s, i) => (s < stars[lowest] ? i : lowest),
    0,
  );
  const kept = stars.filter((_, i) => i !== lowestIndex);

  const sum = kept.reduce((total, s) => total + s, 0);
  return sum / kept.length;
}
