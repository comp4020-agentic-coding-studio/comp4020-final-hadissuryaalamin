import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";

// HTTP-contract tests for POST /api/slack/events (epic slack-integration,
// task 006). Talks to the real running app over HTTP only; the signature is
// computed here with node:crypto, nothing is imported from src/.
//
// Both processes need the same env: the SERVER must be started with
// SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID and SLACK_TEST_STUB=1 (the stub makes
// the Slack post a logged no-op, so nothing real is ever sent), and this TEST
// process needs the same SLACK_SIGNING_SECRET and SLACK_CHANNEL_ID so it can
// sign requests and target the allowed channel. Behaviour behind the 200 ack
// (unmapped sender reply, dedupe, thread targeting) is unit-tested in src/api,
// since spec/ only sees HTTP responses.
const baseUrl = inject("baseUrl");

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

function sign(timestamp: string, rawBody: string, secret: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function postEvents(rawBody: string, headers: { timestamp: string; signature: string }): Promise<Response> {
  return fetch(new URL("/api/slack/events", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": headers.timestamp,
      "x-slack-signature": headers.signature,
    },
    body: rawBody,
  });
}

function signedPost(rawBody: string, timestamp = nowSeconds()): Promise<Response> {
  return postEvents(rawBody, { timestamp, signature: sign(timestamp, rawBody, SIGNING_SECRET as string) });
}

beforeAll(() => {
  if (!SIGNING_SECRET || !CHANNEL_ID) {
    throw new Error(
      "SLACK_SIGNING_SECRET and/or SLACK_CHANNEL_ID are not set in this test process's " +
        "environment. The server needs SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID and " +
        "SLACK_TEST_STUB=1 set BEFORE it boots, and this test process needs the same " +
        "SLACK_SIGNING_SECRET and SLACK_CHANNEL_ID exported when you run `pnpm check`.",
    );
  }
});

describe("POST /api/slack/events", () => {
  it("answers a validly signed url_verification with the challenge", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "spec-challenge-123" });
    const res = await signedPost(body);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({ challenge: "spec-challenge-123" });
  });

  it("rejects a wrong signature with 401", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "spec-challenge-123" });
    const timestamp = nowSeconds();
    const res = await postEvents(body, {
      timestamp,
      signature: sign(timestamp, body, "not-the-signing-secret"),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a validly signed request with a 10 minute old timestamp with 401", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "spec-challenge-123" });
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const res = await signedPost(body, stale);
    expect(res.status).toBe(401);
  });

  it("acks a signed message from an unmapped user in the allowed channel with 200", async () => {
    const ts = `${Math.floor(Date.now() / 1000)}.000100`;
    const body = JSON.stringify({
      type: "event_callback",
      event_id: `EvSpec${Date.now()}`,
      event: {
        type: "message",
        channel: CHANNEL_ID,
        user: "UUNMAPPED01",
        text: "can I have 12 Smith St?",
        ts,
      },
    });
    const res = await signedPost(body);
    expect(res.status, await res.text()).toBe(200);
  });
});
