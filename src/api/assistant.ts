// Assistant route: epic.md "assistant" section and task 004. Routing only —
// role inference mirrors GET /api/me (task 001's getMyStatus/cleaner row
// lookup), the actual Anthropic tool-use loop is task 003's
// src/assistant/client.ts (runAssistant). Same plugin shape as
// src/api/admin.ts/src/api/cleaner.ts: `(app, { db }) => Promise<void>`.

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/index.ts";
import { runAssistant } from "../assistant/client.ts";
import type { CleanerRow } from "../db/types.ts";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_FILE_CONTENT_LENGTH = 262144;

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
        | { message?: string; file?: { name?: string; content?: string } }
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

      const userId = request.session!.user_id;
      const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(userId) as
        | CleanerRow
        | undefined;
      const role = cleaner ? "cleaner" : "admin";

      try {
        const text = await runAssistant(message, { db, role, userId, attachedFile });
        return reply.send({ reply: text });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: errorMessage });
      }
    },
  );
}
