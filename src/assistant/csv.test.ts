import { describe, expect, it } from "vitest";
import { parseReviewsCsv, parseCleanersCsv, parsePropertiesCsv } from "./csv.ts";

describe("parseReviewsCsv", () => {
  const cleaners = [
    { cleaner_id: 1, username: "alice" },
    { cleaner_id: 2, username: "Bob" },
  ];

  it("parses valid username,stars rows with case-insensitive username lookup", () => {
    const result = parseReviewsCsv("alice,5\nbob,3", cleaners);
    expect(result.items).toEqual([
      { cleaner_id: 1, stars: 5 },
      { cleaner_id: 2, stars: 3 },
    ]);
    expect(result.unknownUsernames).toEqual([]);
  });

  it("skips a username header row", () => {
    const result = parseReviewsCsv("username,stars\nalice,5", cleaners);
    expect(result.items).toEqual([{ cleaner_id: 1, stars: 5 }]);
  });

  it("collects unknown usernames instead of failing", () => {
    const result = parseReviewsCsv("alice,5\nghost,4", cleaners);
    expect(result.items).toEqual([{ cleaner_id: 1, stars: 5 }]);
    expect(result.unknownUsernames).toEqual(["ghost"]);
  });

  it("deduplicates repeated unknown usernames", () => {
    const result = parseReviewsCsv("ghost,4\nghost,2", cleaners);
    expect(result.unknownUsernames).toEqual(["ghost"]);
  });

  it("skips stars outside 1-5 or non-integer stars silently", () => {
    const result = parseReviewsCsv("alice,0\nalice,6\nalice,2.5\nalice,notanumber\nalice,4", cleaners);
    expect(result.items).toEqual([{ cleaner_id: 1, stars: 4 }]);
    expect(result.unknownUsernames).toEqual([]);
  });

  it("skips malformed lines (missing column) silently", () => {
    const result = parseReviewsCsv("alice\n,5\n\nalice,4", cleaners);
    expect(result.items).toEqual([{ cleaner_id: 1, stars: 4 }]);
  });

  it("returns empty results for empty input", () => {
    const result = parseReviewsCsv("", cleaners);
    expect(result).toEqual({ items: [], unknownUsernames: [] });
  });
});

describe("parseCleanersCsv", () => {
  it("parses valid username,password rows", () => {
    const result = parseCleanersCsv("new-1,pass1\nnew-2,pass2");
    expect(result.rows).toEqual([
      { username: "new-1", password: "pass1" },
      { username: "new-2", password: "pass2" },
    ]);
    expect(result.invalidLines).toEqual([]);
  });

  it("skips a username header row", () => {
    const result = parseCleanersCsv("username,password\nnew-1,pass1");
    expect(result.rows).toEqual([{ username: "new-1", password: "pass1" }]);
  });

  it("collects empty or malformed lines as invalid rather than throwing", () => {
    const result = parseCleanersCsv("new-1,pass1\nmissing-password\n,empty-username\nnew-2,pass2");
    expect(result.rows).toEqual([
      { username: "new-1", password: "pass1" },
      { username: "new-2", password: "pass2" },
    ]);
    expect(result.invalidLines).toEqual(["missing-password", ",empty-username"]);
  });

  it("returns empty results for empty input", () => {
    const result = parseCleanersCsv("");
    expect(result).toEqual({ rows: [], invalidLines: [] });
  });
});

describe("parsePropertiesCsv", () => {
  it("parses valid name,address rows", () => {
    const result = parsePropertiesCsv("Sunset Villa,1 Beach Rd\nHilltop House,2 Hill St");
    expect(result.rows).toEqual([
      { name: "Sunset Villa", address: "1 Beach Rd" },
      { name: "Hilltop House", address: "2 Hill St" },
    ]);
    expect(result.invalidLines).toEqual([]);
  });

  it("skips a name header row", () => {
    const result = parsePropertiesCsv("name,address\nSunset Villa,1 Beach Rd");
    expect(result.rows).toEqual([{ name: "Sunset Villa", address: "1 Beach Rd" }]);
  });

  it("collects empty or malformed lines as invalid rather than throwing", () => {
    const result = parsePropertiesCsv("Sunset Villa,1 Beach Rd\nmissing-address\n,empty-name");
    expect(result.rows).toEqual([{ name: "Sunset Villa", address: "1 Beach Rd" }]);
    expect(result.invalidLines).toEqual(["missing-address", ",empty-name"]);
  });

  it("returns empty results for empty input", () => {
    const result = parsePropertiesCsv("");
    expect(result).toEqual({ rows: [], invalidLines: [] });
  });
});
