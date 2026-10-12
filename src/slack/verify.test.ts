import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "./verify";

const secret = "test-signing-secret";
const now = 1_700_000_000;
const body = '{"type":"event_callback"}';

function sign(timestamp: string, rawBody: string, key = secret): string {
  return "v0=" + createHmac("sha256", key).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

function check(overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}): boolean {
  const timestamp = String(now);
  return verifySlackSignature({
    signingSecret: secret,
    timestamp,
    signature: sign(timestamp, body),
    rawBody: body,
    nowSeconds: now,
    ...overrides,
  });
}

describe("verifySlackSignature", () => {
  it("accepts a valid signature", () => {
    expect(check()).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(check({ rawBody: body + " " })).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(check({ signature: sign(String(now), body, "other-secret") })).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const timestamp = String(now - 301);
    expect(check({ timestamp, signature: sign(timestamp, body) })).toBe(false);
  });

  it("rejects a future timestamp", () => {
    const timestamp = String(now + 301);
    expect(check({ timestamp, signature: sign(timestamp, body) })).toBe(false);
  });

  it("accepts a timestamp at the edge of the window", () => {
    const timestamp = String(now - 300);
    expect(check({ timestamp, signature: sign(timestamp, body) })).toBe(true);
  });

  it("rejects a non-integer timestamp", () => {
    const timestamp = "12abc";
    expect(check({ timestamp, signature: sign(timestamp, body) })).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(check({ signature: "nonsense" })).toBe(false);
    expect(check({ signature: "" })).toBe(false);
    expect(check({ signature: sign(String(now), body).slice(3) })).toBe(false);
  });
});
