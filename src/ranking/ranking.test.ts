// Ranking engine tests. Colocated here rather than at spec/ranking.test.ts
// as task 003's file names it — see .claude/epics/cleaner-performance/
// updates/003.md for why: spec/ only runs against a live HTTP server
// (spec/global-setup.ts waits up to a minute for APP_URL, then fails if
// nothing answers), but these are pure functions with zero HTTP dependency.
// Run with `pnpm test:unit` (vitest.unit.config.ts: src/**/*.test.ts, no
// globalSetup).

import { describe, expect, it } from "vitest";
import { activePeriod, computeScore } from "./score.ts";
import { capForRank, computeLeaderboard } from "./leaderboard.ts";
import { slotsToDrop } from "./picks.ts";
import type { CleanerForLeaderboard } from "./types.ts";

describe("computeScore", () => {
  it("redemption case: five 5-star + one 1-star, drop the 1-star -> 5.0", () => {
    const reviews = [
      { stars: 5 },
      { stars: 5 },
      { stars: 5 },
      { stars: 5 },
      { stars: 5 },
      { stars: 1 },
    ];
    expect(computeScore(reviews)).toBe(5.0);
  });

  it("returns null for fewer than 5 reviews, regardless of star values", () => {
    const reviews = [{ stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 5 }];
    expect(computeScore(reviews)).toBeNull();
  });

  it("drops exactly one lowest review even with many reviews beyond 5", () => {
    // 10 reviews, lowest is a single 2-star amongst 4-and-5-stars.
    const reviews = [
      { stars: 5 },
      { stars: 5 },
      { stars: 4 },
      { stars: 4 },
      { stars: 5 },
      { stars: 2 },
      { stars: 5 },
      { stars: 4 },
      { stars: 5 },
      { stars: 4 },
    ];
    // Sum of all 10 = 43; drop the single 2 -> sum 41 over 9 reviews.
    expect(computeScore(reviews)).toBeCloseTo(41 / 9, 10);
  });

  it("drops only one copy of the lowest star value when it's tied", () => {
    const reviews = [{ stars: 1 }, { stars: 1 }, { stars: 5 }, { stars: 5 }, { stars: 5 }];
    // Drop a single 1 -> remaining [1, 5, 5, 5] averaged out of 5.
    expect(computeScore(reviews)).toBe((1 + 5 + 5 + 5) / 4);
  });
});

describe("activePeriod", () => {
  it("keeps only reviews from the max period across the cleaner's reviews", () => {
    const reviews = [
      { stars: 3, period: "2026-08" },
      { stars: 5, period: "2026-09" },
      { stars: 4, period: "2026-09" },
      { stars: 1, period: "2026-07" },
    ];
    expect(activePeriod(reviews)).toEqual([
      { stars: 5, period: "2026-09" },
      { stars: 4, period: "2026-09" },
    ]);
  });

  it("returns an empty array for no reviews", () => {
    expect(activePeriod([])).toEqual([]);
  });
});

describe("computeLeaderboard", () => {
  // Helper: a cleaner with `count` reviews, all `stars`, so score and count
  // are easy to reason about without writing each review out longhand.
  function cleaner(cleanerId: number, count: number, stars: number): CleanerForLeaderboard {
    return { cleanerId, reviews: Array.from({ length: count }, () => ({ stars })) };
  }

  it("forces an ineligible (<5 reviews) cleaner to normal regardless of stars", () => {
    const cleaners = [cleaner(1, 4, 5)];
    const result = computeLeaderboard(cleaners);
    expect(result).toEqual([{ cleanerId: 1, rank: "normal" }]);
  });

  it("splits the leaderboard at the 15/legend and 10/awesome cap boundary", () => {
    // 27 eligible cleaners, all with identical score (5.0: five 5-stars
    // plus one dropped low review) and identical review count, so the
    // id-ascending tie-break alone determines order: 1..27.
    const cleaners: CleanerForLeaderboard[] = Array.from({ length: 27 }, (_, i) =>
      cleaner(i + 1, 5, 5),
    ).map((c) => ({ ...c, reviews: [...c.reviews, { stars: 1 }] }));

    const result = computeLeaderboard(cleaners);
    const byId = new Map(result.map((r) => [r.cleanerId, r.rank]));

    const legendIds = result.filter((r) => r.rank === "legend").map((r) => r.cleanerId);
    const awesomeIds = result.filter((r) => r.rank === "awesome").map((r) => r.cleanerId);
    const normalIds = result.filter((r) => r.rank === "normal").map((r) => r.cleanerId);

    expect(legendIds).toHaveLength(15);
    expect(awesomeIds).toHaveLength(10);
    expect(normalIds).toHaveLength(2);
    expect(byId.get(1)).toBe("legend");
    expect(byId.get(15)).toBe("legend");
    expect(byId.get(16)).toBe("awesome");
    expect(byId.get(25)).toBe("awesome");
    expect(byId.get(26)).toBe("normal");
    expect(byId.get(27)).toBe("normal");
  });

  it("tie-breaks equal scores by descending review count", () => {
    // Both score 5.0 (five 5-stars after dropping a 1-star), but cleaner 2
    // has more reviews this period, so should rank above cleaner 1.
    const cleaners: CleanerForLeaderboard[] = [
      { cleanerId: 1, reviews: [{ stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 1 }] },
      { cleanerId: 2, reviews: [{ stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 5 }, { stars: 1 }] },
    ];
    const result = computeLeaderboard(cleaners);
    const order = result.map((r) => r.cleanerId);
    expect(order).toEqual([2, 1]);
  });

  it("tie-breaks equal score and equal review count by cleaner id ascending", () => {
    const cleaners: CleanerForLeaderboard[] = [
      cleaner(9, 5, 5),
      cleaner(3, 5, 5),
      cleaner(7, 5, 5),
    ];
    const result = computeLeaderboard(cleaners);
    expect(result.map((r) => r.cleanerId)).toEqual([3, 7, 9]);
  });
});

describe("capForRank", () => {
  it("maps legend -> 5, awesome -> 3, normal -> 0", () => {
    expect(capForRank("legend")).toBe(5);
    expect(capForRank("awesome")).toBe(3);
    expect(capForRank("normal")).toBe(0);
  });
});

describe("slotsToDrop", () => {
  it("legend -> awesome (cap 3) drops slots 4 and 5", () => {
    const picks = [{ slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 4 }, { slot: 5 }];
    expect(slotsToDrop(picks, capForRank("awesome"))).toEqual([4, 5]);
  });

  it("awesome -> normal (cap 0) drops all 3", () => {
    const picks = [{ slot: 1 }, { slot: 2 }, { slot: 3 }];
    expect(slotsToDrop(picks, capForRank("normal"))).toEqual([1, 2, 3]);
  });

  it("legend -> normal (cap 0) drops all 5", () => {
    const picks = [{ slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 4 }, { slot: 5 }];
    expect(slotsToDrop(picks, capForRank("normal"))).toEqual([1, 2, 3, 4, 5]);
  });

  it("promotion (higher cap) drops nothing", () => {
    const picks = [{ slot: 1 }, { slot: 2 }, { slot: 3 }];
    expect(slotsToDrop(picks, capForRank("legend"))).toEqual([]);
  });

  it("keeps the lowest-numbered slots when fewer picks than the new cap", () => {
    const picks = [{ slot: 1 }, { slot: 3 }];
    expect(slotsToDrop(picks, 1)).toEqual([3]);
  });
});
