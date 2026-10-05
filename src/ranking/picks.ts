// Preferred-property demotion: epic.md "Preferred properties (picks)"
// section. Pure function only — the actual DB delete happens wherever this
// is called from (task 004's reviews-batch and rank-override handlers).

import type { PickSlot } from "./types.ts";

/**
 * Which slot numbers exceed `newCap` and must be dropped, keeping the
 * lowest-numbered (earliest-picked) slots. E.g. legend -> awesome
 * (newCap 3) drops slots 4 and 5; awesome -> normal (newCap 0) drops all 3;
 * legend -> normal (newCap 0) drops all 5.
 *
 * Returned in ascending order; doesn't mutate `currentPicks`.
 */
export function slotsToDrop(currentPicks: PickSlot[], newCap: number): number[] {
  return currentPicks
    .map((p) => p.slot)
    .filter((slot) => slot > newCap)
    .sort((a, b) => a - b);
}
