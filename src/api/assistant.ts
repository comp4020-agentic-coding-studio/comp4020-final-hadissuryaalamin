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
      const message = (request.body as { message?: string } | undefined)?.message;
      if (typeof message !== "string" || message.trim().length === 0 || message.length > MAX_MESSAGE_LENGTH) {
        return reply.code(400).send({ error: "message is required" });
      }

      const userId = request.session!.user_id;
      const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(userId) as
        | CleanerRow
        | undefined;
      const role = cleaner ? "cleaner" : "admin";

      try {
        const text = await runAssistant(message, { db, role, userId });
        return reply.send({ reply: text });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: errorMessage });
      }
    },
  );
}
