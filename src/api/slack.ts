// Slack Events API webhook: epic slack-integration, task 004.
//
// Slack retries any webhook not answered with a 2xx within 3 seconds and an
// LLM call takes longer, so the route verifies, dedupes and filters
// synchronously, answers 200, then does the lookup, assistant call and Slack
// post in a detached promise whose errors are caught and logged.
//
// Slack signs the exact raw bytes, so this plugin registers its own
// application/json parser (parseAs: "string") that keeps the raw string and
// parses it itself. Registered without fastify-plugin, so the parser is
// scoped to this plugin and no other route's body parsing changes.
//
// Never log the bot token or message text.

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { runAssistant as realRunAssistant } from "../assistant/client.ts";
import type { CleanerRow } from "../db/types.ts";
import { postThreadReply as realPostThreadReply } from "../slack/client.ts";
import { seenEvent } from "../slack/dedupe.ts";
import { verifySlackSignature } from "../slack/verify.ts";

const NOT_LINKED_TEXT = "Your Slack account isn't linked to a cleaner account yet. Ask an Admin to link it.";

export interface SlackDeps {
  postThreadReply?: (channel: string, threadTs: string, text: string) => Promise<void>;
  runAssistant?: typeof realRunAssistant;
}

interface SlackEnvelope {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  };
}

export default async function slackRoutes(
  app: FastifyInstance,
  opts: { db: Database.Database; deps?: SlackDeps },
): Promise<void> {
  const { db } = opts;
  const postThreadReply = opts.deps?.postThreadReply ?? realPostThreadReply;
  const runAssistant = opts.deps?.runAssistant ?? realRunAssistant;

  const rawBodies = new WeakMap<FastifyRequest, string>();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const raw = body as string;
    rawBodies.set(request, raw);
    try {
      done(null, JSON.parse(raw));
    } catch {
      const err = new Error("invalid JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  async function handleMessage(channel: string, threadTs: string, slackUserId: string, text: string): Promise<void> {
    try {
      const cleaner = db.prepare("SELECT * FROM cleaners WHERE slack_user_id = ?").get(slackUserId) as
        | CleanerRow
        | undefined;
      let reply: string;
      if (!cleaner) {
        reply = NOT_LINKED_TEXT;
      } else {
        try {
          reply = await runAssistant(text, { db, role: "cleaner", userId: cleaner.user_id });
        } catch (err) {
          reply = err instanceof Error ? err.message : String(err);
        }
      }
      await postThreadReply(channel, threadTs, reply);
    } catch (err) {
      // postThreadReply's errors carry only Slack's error code, never the token.
      app.log.error({ slackError: err instanceof Error ? err.message : "unknown" }, "slack reply failed");
    }
  }

  app.post("/api/slack/events", async (request, reply) => {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const channelId = process.env.SLACK_CHANNEL_ID;
    const botToken = process.env.SLACK_BOT_TOKEN;
    const stub = process.env.SLACK_TEST_STUB === "1";
    if (!signingSecret || !channelId || (!botToken && !stub)) {
      return reply.code(503).send({ error: "slack is not configured" });
    }

    const timestamp = request.headers["x-slack-request-timestamp"];
    const signature = request.headers["x-slack-signature"];
    const rawBody = rawBodies.get(request);
    if (
      typeof timestamp !== "string" ||
      typeof signature !== "string" ||
      rawBody === undefined ||
      !verifySlackSignature({ signingSecret, timestamp, signature, rawBody })
    ) {
      return reply.code(401).send({ error: "invalid slack signature" });
    }

    const body = (request.body ?? {}) as SlackEnvelope;
    if (body.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }
    if (body.type !== "event_callback") {
      return reply.code(200).send();
    }

    if (typeof body.event_id === "string" && seenEvent(body.event_id)) {
      return reply.code(200).send();
    }

    const event = body.event;
    if (
      !event ||
      event.type !== "message" ||
      event.subtype !== undefined ||
      event.bot_id !== undefined ||
      event.channel !== channelId ||
      typeof event.user !== "string" ||
      typeof event.text !== "string" ||
      typeof event.ts !== "string"
    ) {
      return reply.code(200).send();
    }

    const threadTs = event.thread_ts ?? event.ts;
    void handleMessage(channelId, threadTs, event.user, event.text);
    return reply.code(200).send();
  });
}
