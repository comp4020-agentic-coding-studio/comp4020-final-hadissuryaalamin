// Slack request-signature check for the Events API webhook.
//
// Slack signs every request: HMAC-SHA256 over `v0:<timestamp>:<raw body>`
// keyed with the app's signing secret, sent as `X-Slack-Signature: v0=<hex>`
// alongside `X-Slack-Request-Timestamp`. The raw body must be the exact bytes
// Slack sent, not a re-serialised parse. A timestamp more than five minutes
// from now is rejected so a captured request cannot be replayed later.
//
// Pure function: no HTTP, no env access, no logging of secrets.

import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 300;

export interface VerifyParams {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  nowSeconds?: number;
}

export function verifySlackSignature(params: VerifyParams): boolean {
  const { signingSecret, timestamp, signature, rawBody } = params;
  const nowSeconds = params.nowSeconds ?? Date.now() / 1000;

  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  const expected =
    "v0=" + createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
