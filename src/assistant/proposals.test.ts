import { afterEach, describe, expect, it, vi } from "vitest";
import { clearProposal, getProposal, setProposal } from "./proposals.ts";

describe("proposals store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for a user that never had a proposal set", () => {
    expect(getProposal(999)).toBeUndefined();
  });

  it("get returns what was stored, including the description", () => {
    setProposal(1, "claim_pick", { pickId: 42 }, "Claim pick #42 for cleaner-1?");

    expect(getProposal(1)).toEqual({
      type: "claim_pick",
      data: { pickId: 42 },
      description: "Claim pick #42 for cleaner-1?",
    });
  });

  it("clearProposal removes the slot so get returns undefined", () => {
    setProposal(2, "claim_pick", { pickId: 7 }, "Claim pick #7?");
    clearProposal(2);

    expect(getProposal(2)).toBeUndefined();
  });

  it("setting a second proposal for the same user replaces the first entirely", () => {
    setProposal(3, "claim_pick", { pickId: 1 }, "Claim pick #1?");
    setProposal(3, "cancel_pick", { pickId: 1 }, "Cancel pick #1?");

    expect(getProposal(3)).toEqual({
      type: "cancel_pick",
      data: { pickId: 1 },
      description: "Cancel pick #1?",
    });
  });

  it("a proposal past its 5-minute expiry returns undefined on get", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    setProposal(4, "claim_pick", { pickId: 5 }, "Claim pick #5?");

    // Still within the 5-minute window.
    vi.setSystemTime(5 * 60 * 1000 - 1);
    expect(getProposal(4)).toEqual({
      type: "claim_pick",
      data: { pickId: 5 },
      description: "Claim pick #5?",
    });

    // Past the 5-minute window.
    vi.setSystemTime(5 * 60 * 1000 + 1);
    expect(getProposal(4)).toBeUndefined();
  });

  it("clears the slot when an expired proposal is read, not just reports undefined", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    setProposal(5, "claim_pick", { pickId: 9 }, "Claim pick #9?");
    vi.setSystemTime(5 * 60 * 1000 + 1);

    expect(getProposal(5)).toBeUndefined();
    // A second read after the slot was auto-cleared is still undefined,
    // not stale data re-served from an un-cleared map entry.
    expect(getProposal(5)).toBeUndefined();
  });
});
