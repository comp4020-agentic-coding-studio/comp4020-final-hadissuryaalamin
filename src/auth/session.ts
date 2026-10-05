import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "../db/types.ts";

// Hand-rolled signed session token (no @fastify/secure-session /
// @fastify/cookie dependency): `<base64url-json-payload>.<base64url-hmac>`.
// Kept minimal and dependency-free since task 006 (server bootstrap) hasn't
// landed yet and this module needs to be independently testable without a
// running Fastify instance. Guards in ./guards.ts read the raw `Cookie`
// header directly, so no cookie-parsing plugin is required either.

export const SESSION_COOKIE_NAME = "session";

export interface SessionPayload {
  user_id: number;
  role: Role;
}

function getSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET env var is required to sign/verify session cookies");
  }
  return secret;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Encodes and signs a session payload with `SESSION_SECRET`. */
export function createSessionToken(payload: SessionPayload, env: NodeJS.ProcessEnv = process.env): string {
  const secret = getSecret(env);
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

/**
 * Verifies a token's HMAC signature and shape. Returns the payload, or
 * `null` if missing, malformed, tampered with, or signed under a different
 * secret.
 */
export function verifySessionToken(
  token: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const secret = getSecret(env);
  const expected = sign(body, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).user_id === "number" &&
      ((parsed as Record<string, unknown>).role === "admin" || (parsed as Record<string, unknown>).role === "cleaner")
    ) {
      const p = parsed as SessionPayload;
      return { user_id: p.user_id, role: p.role };
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads the session token's raw (still unverified) value out of a `Cookie` header. */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/** Builds the `Set-Cookie` header value to log a session in. */
export function buildSessionCookieHeader(token: string, opts: { secure?: boolean } = {}): string {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  const attrs = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Builds the `Set-Cookie` header value to log a session out. */
export function buildClearSessionCookieHeader(opts: { secure?: boolean } = {}): string {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  const attrs = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
