import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../db/types.ts";
import { readSessionCookie, verifySessionToken, type SessionPayload } from "./session.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth`/`requireRole` once the session cookie verifies. */
    session?: SessionPayload;
  }
}

function extractSession(request: FastifyRequest): SessionPayload | null {
  const token = readSessionCookie(request.headers.cookie);
  return verifySessionToken(token);
}

/** Fastify preHandler-shaped guard: 401s any request without a valid session cookie. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = extractSession(request);
  if (!session) {
    await reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  request.session = session;
}

/** Fastify preHandler-shaped guard factory: 401s with no session, 403s if the session's role doesn't match. */
export function requireRole(role: Role) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = extractSession(request);
    if (!session) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    if (session.role !== role) {
      await reply.code(403).send({ error: "Forbidden" });
      return;
    }
    request.session = session;
  };
}
