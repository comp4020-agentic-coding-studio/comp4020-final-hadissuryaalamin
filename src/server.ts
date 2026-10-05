// Fastify app entrypoint — task 006. Wires together everything tasks
// 001-005 built: the DB singleton, the hand-rolled session-cookie auth, and
// the admin/cleaner route plugins. Run directly with `node src/server.ts`
// (Node 24's native TypeScript support strips types with no build step and
// no flag — see the Dockerfile for why the runtime image relies on this
// instead of a `tsc` build stage).

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { marked } from "marked";
import { db } from "./db/index.ts";
import type { UserRow } from "./db/types.ts";
import {
  verifyPassword,
  createSessionToken,
  readSessionCookie,
  verifySessionToken,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  seedAdminIfMissing,
} from "./auth/index.ts";
import adminRoutes from "./api/admin.ts";
import cleanerRoutes from "./api/cleaner.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// SESSION_SECRET signs the session cookie (see src/auth/session.ts). It must
// be set for the app to boot at all (session.ts throws without it). In
// production, set it with `flyctl secrets set SESSION_SECRET=...` so it's
// stable across restarts/redeploys — logged-in sessions survive a restart
// only if the secret doesn't change. For local dev/test convenience (so the
// server boots with zero setup) we generate a random one here when it's
// missing; that's fine for a throwaway dev session but means every restart
// invalidates existing cookies, which is acceptable for a dev box and is NOT
// how it should run in prod (hence the recommendation above).
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = randomBytes(32).toString("base64url");
}

export function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: true });

  // Reads the session cookie (if any) on every request and attaches
  // `request.session` — the shape `requireAuth`/`requireRole` in
  // src/auth/guards.ts read off `request`. Those guards also re-derive the
  // session themselves (they need to 401/403 independently of this hook
  // running), so this hook's job is purely to make `request.session`
  // available to routes that want to know who's logged in without
  // *requiring* a session (none currently do, but it's the integration
  // point the task calls for).
  app.addHook("onRequest", async (request) => {
    const token = readSessionCookie(request.headers.cookie);
    const session = verifySessionToken(token);
    if (session) {
      request.session = session;
    }
  });

  // Static assets: task 007 lands its real frontend in public/; wiring this
  // up now means those files just work once they land. `index: true` means
  // GET / serves public/index.html automatically.
  app.register(fastifyStatic, {
    root: join(__dirname, "..", "public"),
    index: ["index.html"],
  });

  // POST /login — verifies username+password against `users`, sets the
  // signed session cookie.
  app.post<{ Body: { username?: string; password?: string } }>("/login", async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      return reply.code(400).send({ error: "username and password are required" });
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    if (!user) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const token = createSessionToken({ user_id: user.id, role: user.role });
    reply.header("set-cookie", buildSessionCookieHeader(token));
    return reply.send({ user_id: user.id, username: user.username, role: user.role });
  });

  // POST /logout — clears the session cookie. No auth required to call it
  // (clearing an already-absent cookie is harmless).
  app.post("/logout", async (_request, reply) => {
    reply.header("set-cookie", buildClearSessionCookieHeader());
    return reply.send({ ok: true });
  });

  // GET /readme/ — renders the real README.md to HTML. spec/invariants.test.ts
  // checks every ATX heading appears, in order, in the served text.
  app.get("/readme/", async (_request, reply) => {
    const markdown = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    const body = marked.parse(markdown) as string;
    const html = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About</title>
  </head>
  <body>
    <main>
${body}
    </main>
  </body>
</html>
`;
    reply.type("text/html");
    return reply.send(html);
  });

  app.register(adminRoutes, { db });
  app.register(cleanerRoutes, { db });

  return app;
}

async function main(): Promise<void> {
  // Boots the admin account from SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD if
  // none exists yet; no-op otherwise (see src/auth/seed.ts).
  await seedAdminIfMissing(db);

  const app = buildApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}

// This module is only ever run directly (`node src/server.ts`), never
// imported by a test — `buildApp` above is exported for that if a future
// task wants it, but nothing currently does.
main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
