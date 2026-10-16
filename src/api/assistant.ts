// Assistant route: epic.md "assistant" section and task 004. Routing only —
// role inference mirrors GET /api/me (task 001's getMyStatus/cleaner row
// lookup), the actual Anthropic tool-use loop is task 003's
// src/assistant/client.ts (runAssistant). Same plugin shape as
// src/api/admin.ts/src/api/cleaner.ts: `(app, { db }) => Promise<void>`.

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/index.ts";
import { runAssistant, type HistoryTurn } from "../assistant/client.ts";
import type { CleanerRow } from "../db/types.ts";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_FILE_CONTENT_LENGTH = 262144;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_TURN_LENGTH = 4000;

/** Validates the chat page's on-screen history; returns the last 20 turns, or null if malformed. */
function parseHistory(raw: unknown): HistoryTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: HistoryTurn[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { role, text } = item as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return null;
    if (text.length > MAX_HISTORY_TURN_LENGTH) return null;
    turns.push({ role, text });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

export default async function assistantRoutes(
  app: FastifyInstance,
  opts: { db: Database.Database },
): Promise<void> {
  const { db } = opts;
  const authed = { preHandler: requireAuth };

  app.post(
    "/api/assistant",
    authed,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as
        | { message?: string; file?: { name?: string; content?: string }; history?: unknown }
        | undefined;
      const message = body?.message;
      if (typeof message !== "string" || message.trim().length === 0 || message.length > MAX_MESSAGE_LENGTH) {
        return reply.code(400).send({ error: "message is required" });
      }

      const file = body?.file;
      let attachedFile: { name: string; content: string } | undefined;
      if (file !== undefined) {
        if (typeof file.name !== "string" || typeof file.content !== "string") {
          return reply.code(400).send({ error: "file.name and file.content must be strings" });
        }
        if (file.content.length > MAX_FILE_CONTENT_LENGTH) {
          return reply.code(400).send({ error: "file is too large (max 256KB)" });
        }
        attachedFile = { name: file.name, content: file.content };
      }

      let history: HistoryTurn[] | undefined;
      if (body?.history !== undefined) {
        const parsed = parseHistory(body.history);
        if (!parsed) {
          return reply.code(400).send({ error: "history is not valid" });
        }
        history = parsed;
      }

      const userId = request.session!.user_id;
      const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(userId) as
        | CleanerRow
        | undefined;
      const role = cleaner ? "cleaner" : "admin";

      try {
        const text = history
          ? await runAssistant(message, { db, role, userId, attachedFile }, history)
          : await runAssistant(message, { db, role, userId, attachedFile });
        return reply.send({ reply: text });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: errorMessage });
      }
    },
  );
}
