import { beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, readSessionCookie, verifySessionToken } from "./session.ts";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

describe("session tokens", () => {
  it("round-trips a payload", () => {
    const token = createSessionToken({ user_id: 42, role: "admin" });
    expect(verifySessionToken(token)).toEqual({ user_id: 42, role: "admin" });
  });

  it("rejects a tampered token", () => {
    const token = createSessionToken({ user_id: 42, role: "cleaner" });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken({ user_id: 1, role: "cleaner" }, { SESSION_SECRET: "other-secret" } as NodeJS.ProcessEnv);
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects malformed or missing input", () => {
    expect(verifySessionToken("not-a-token")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
  });
});

describe("readSessionCookie", () => {
  it("extracts the session cookie's value from a Cookie header", () => {
    expect(readSessionCookie("other=1; session=abc.def; another=2")).toBe("abc.def");
  });

  it("returns undefined when the cookie is absent", () => {
    expect(readSessionCookie("other=1")).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
  });
});
