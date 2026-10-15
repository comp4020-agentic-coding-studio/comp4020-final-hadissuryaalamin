import { createHmac } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection } from "../db/connection.ts";
import { resetSeenEvents } from "../slack/dedupe.ts";
import slackRoutes from "./slack.ts";

const SECRET = "test-signing-secret";
const CHANNEL = "C_TEST";
const URL_PATH = "/api/slack/events";

function sign(timestamp: string, rawBody: string, secret = SECRET): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

interface Harness {
  app: FastifyInstance;
  db: Database.Database;
  postThreadReply: ReturnType<typeof vi.fn>;
  runAssistant: ReturnType<typeof vi.fn>;
  // Resolves when the first postThreadReply call has happened.
  posted: Promise<void>;
}

function build(): Harness {
  const db = createConnection(":memory:");
  let notify: () => void = () => {};
  const posted = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const postThreadReply = vi.fn(async () => {
    notify();
  });
  const runAssistant = vi.fn(async () => "assistant says hi");
  const app = fastify();
  app.register(slackRoutes, { db, deps: { postThreadReply, runAssistant } });
  return { app, db, postThreadReply, runAssistant, posted };
}

function addCleaner(db: Database.Database, slackId: string): number {
  const userId = Number(
    db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'cleaner')")
      .run(`user-${slackId}`, "h").lastInsertRowid,
  );
  db.prepare("INSERT INTO cleaners (user_id, rank, slack_user_id) VALUES (?, 'normal', ?)").run(userId, slackId);
  return userId;
}

function messageBody(eventOverrides: Record<string, unknown> = {}, eventId = "Ev1"): string {
  return JSON.stringify({
    type: "event_callback",
    event_id: eventId,
    event: {
      type: "message",
      channel: CHANNEL,
      user: "U1",
      text: "can I have 12 Smith St?",
      ts: "1700000000.000100",
      ...eventOverrides,
    },
  });
}

async function send(app: FastifyInstance, raw: string, opts: { timestamp?: string; signature?: string } = {}) {
  const timestamp = opts.timestamp ?? nowTs();
  return app.inject({
    method: "POST",
    url: URL_PATH,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": opts.signature ?? sign(timestamp, raw),
    },
    payload: raw,
  });
}

// Used only to prove that NOTHING happened: one macrotask turn drains every
// pending promise callback the detached work could have queued.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_CHANNEL_ID = CHANNEL;
  delete process.env.SLACK_TEST_STUB;
  resetSeenEvents();
});

afterEach(() => {
  delete process.env.SLACK_SIGNING_SECRET;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_CHANNEL_ID;
  delete process.env.SLACK_TEST_STUB;
});

describe("POST /api/slack/events", () => {
  it.each(["SLACK_SIGNING_SECRET", "SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"])("503s when %s is missing", async (name) => {
    const h = build();
    delete process.env[name];
    const res = await send(h.app, messageBody());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "slack is not configured" });
  });

  it("does not need the bot token under SLACK_TEST_STUB=1", async () => {
    const h = build();
    delete process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_TEST_STUB = "1";
    const res = await send(h.app, JSON.stringify({ type: "url_verification", challenge: "abc" }));
    expect(res.statusCode).toBe(200);
  });

  it("401s on a bad signature", async () => {
    const h = build();
    const res = await send(h.app, messageBody(), { signature: "v0=deadbeef" });
    expect(res.statusCode).toBe(401);
    await settle();
    expect(h.runAssistant).not.toHaveBeenCalled();
  });

  it("401s on a stale timestamp even with a matching signature", async () => {
    const h = build();
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const res = await send(h.app, messageBody(), { timestamp });
    expect(res.statusCode).toBe(401);
  });

  it("401s when signature headers are missing", async () => {
    const h = build();
    const res = await h.app.inject({
      method: "POST",
      url: URL_PATH,
      headers: { "content-type": "application/json" },
      payload: messageBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("echoes the url_verification challenge", async () => {
    const h = build();
    const res = await send(h.app, JSON.stringify({ type: "url_verification", challenge: "xyz123" }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ challenge: "xyz123" });
  });

  it("200s and ignores unknown envelope types", async () => {
    const h = build();
    const res = await send(h.app, JSON.stringify({ type: "app_rate_limited" }));
    expect(res.statusCode).toBe(200);
  });

  it("replies with the linking message for an unmapped user and makes no assistant call", async () => {
    const h = build();
    const res = await send(h.app, messageBody());
    expect(res.statusCode).toBe(200);
    await h.posted;
    expect(h.runAssistant).not.toHaveBeenCalled();
    expect(h.postThreadReply).toHaveBeenCalledWith(
      CHANNEL,
      "1700000000.000100",
      "Your Slack account isn't linked to a cleaner account yet. Ask an Admin to link it.",
    );
  });

  it("runs the assistant as a cleaner for a mapped user and replies to the message ts", async () => {
    const h = build();
    const userId = addCleaner(h.db, "U1");
    const res = await send(h.app, messageBody());
    expect(res.statusCode).toBe(200);
    await h.posted;
    expect(h.runAssistant).toHaveBeenCalledTimes(1);
    expect(h.runAssistant).toHaveBeenCalledWith("can I have 12 Smith St?", {
      db: h.db,
      role: "cleaner",
      userId,
      via: "slack",
    });
    expect(h.postThreadReply).toHaveBeenCalledWith(CHANNEL, "1700000000.000100", "assistant says hi");
  });

  it("replies inside the existing thread when the message has a thread_ts", async () => {
    const h = build();
    addCleaner(h.db, "U1");
    await send(h.app, messageBody({ thread_ts: "1699999999.000001", text: "yes" }));
    await h.posted;
    expect(h.runAssistant).toHaveBeenCalledWith("yes", expect.objectContaining({ role: "cleaner" }));
    expect(h.postThreadReply).toHaveBeenCalledWith(CHANNEL, "1699999999.000001", "assistant says hi");
  });

  it("runs nothing for a repeated event_id", async () => {
    const h = build();
    addCleaner(h.db, "U1");
    await send(h.app, messageBody());
    await h.posted;
    const res = await send(h.app, messageBody());
    expect(res.statusCode).toBe(200);
    await settle();
    expect(h.runAssistant).toHaveBeenCalledTimes(1);
    expect(h.postThreadReply).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a bot_id message", { bot_id: "B1" }],
    ["a subtype message", { subtype: "message_changed" }],
    ["a wrong-channel message", { channel: "C_OTHER" }],
  ])("runs nothing for %s", async (_label, eventOverrides) => {
    const h = build();
    addCleaner(h.db, "U1");
    const res = await send(h.app, messageBody(eventOverrides));
    expect(res.statusCode).toBe(200);
    await settle();
    expect(h.runAssistant).not.toHaveBeenCalled();
    expect(h.postThreadReply).not.toHaveBeenCalled();
  });

  it("posts the assistant's error message as text", async () => {
    const h = build();
    addCleaner(h.db, "U1");
    h.runAssistant.mockRejectedValueOnce(new Error("Could not reach the assistant right now."));
    await send(h.app, messageBody());
    await h.posted;
    expect(h.postThreadReply).toHaveBeenCalledWith(
      CHANNEL,
      "1700000000.000100",
      "Could not reach the assistant right now.",
    );
  });

  it("logs only the Slack error code when posting fails, never the message text", async () => {
    const h = build();
    addCleaner(h.db, "U1");
    const logged: string[] = [];
    let logSeen: () => void = () => {};
    const logPromise = new Promise<void>((resolve) => {
      logSeen = resolve;
    });
    const logError = vi.spyOn(h.app.log, "error").mockImplementation(((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
      logSeen();
    }) as never);
    h.postThreadReply.mockRejectedValueOnce(new Error("slack chat.postMessage failed: channel_not_found"));
    const res = await send(h.app, messageBody());
    expect(res.statusCode).toBe(200);
    await logPromise;
    expect(logError).toHaveBeenCalled();
    const out = logged.join("");
    expect(out).toContain("channel_not_found");
    expect(out).not.toContain("xoxb-test");
    expect(out).not.toContain("Smith St");
  });
});
