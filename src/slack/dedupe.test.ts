import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSeenEvents, seenEvent } from "./dedupe";

describe("seenEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSeenEvents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false the first time and true on a repeat", () => {
    expect(seenEvent("Ev1")).toBe(false);
    expect(seenEvent("Ev1")).toBe(true);
  });

  it("tracks ids independently", () => {
    expect(seenEvent("Ev1")).toBe(false);
    expect(seenEvent("Ev2")).toBe(false);
  });

  it("still reports a repeat just inside 10 minutes", () => {
    seenEvent("Ev1");
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(seenEvent("Ev1")).toBe(true);
  });

  it("forgets an id after 10 minutes", () => {
    seenEvent("Ev1");
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(seenEvent("Ev1")).toBe(false);
  });

  it("resetSeenEvents clears everything", () => {
    seenEvent("Ev1");
    resetSeenEvents();
    expect(seenEvent("Ev1")).toBe(false);
  });
});
