import { beforeAll, describe, expect, inject, it } from "vitest";

// HTTP-layer contract tests — task 008. Unlike tasks 004/005's colocated
// unit tests (which inject an in-memory Fastify instance directly), this
// file talks to the real RUNNING server over HTTP, same pattern as
// spec/invariants.test.ts: `fetch(new URL(path, baseUrl))` where `baseUrl`
// comes from spec/global-setup.ts (which waits for something to answer at
// APP_URL/http://localhost:8080).
//
// It intentionally does NOT re-check `/readme/` — spec/invariants.test.ts
// already covers that, and this task's brief says not to duplicate it.
const baseUrl = inject("baseUrl");

// --- Admin seed credentials ------------------------------------------------
//
// The server only has an admin account if it was booted with
// SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD set (src/auth/seed.ts,
// seedAdminIfMissing — a no-op with no error if they're unset, so a dev box
// without them still boots, just with no admin). These tests need to log in
// as admin to exercise admin-only routes and to create fixtures (properties,
// cleaner accounts), so they read the same two env vars here, with the
// expectation that whatever started the server and whatever runs `pnpm
// check` are the same environment and agree on these values.
//
// KNOWN GAP (see updates/008.md and this task's final report): as of this
// task, nothing in this repo actually sets these two vars for the server
// `pnpm check` tests against in CI. `.github/workflows/checks.yml`'s
// `docker run` step only passes `-e PORT=8080` — no
// `-e SEED_ADMIN_USERNAME=...` / `-e SEED_ADMIN_PASSWORD=...` — so in a real
// CI run today, no admin account is ever seeded and every test below that
// needs one will fail at the `beforeAll` login with a clear error, not
// silently. Locally, export both before starting the server yourself, e.g.:
//   SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=admin-password node src/server.ts
// and the same two vars in the shell that then runs `pnpm check`.
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

// --- small HTTP helpers -----------------------------------------------------

/**
 * Logs in and returns the `Cookie` header value to send on subsequent
 * requests for that session. fetch's `Set-Cookie` response header isn't
 * automatically carried over to the next `fetch` call in Node (there's no
 * shared cookie jar like a browser has), so this reads it explicitly off the
 * `/login` response and the caller passes the result back as a `Cookie`
 * request header.
 */
async function login(username: string, password: string): Promise<string> {
  const res = await fetch(new URL("/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) {
    throw new Error(
      `login as "${username}" failed with ${res.status} (${await res.text()}); ` +
        `if this is the admin login, check SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD ` +
        `were set BEFORE the server booted — see the comment above ADMIN_USERNAME ` +
        `in this file for the known CI gap.`,
    );
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`login as "${username}" returned 200 but no set-cookie header`);
  }
  // Only the name=value pair matters for the request Cookie header; drop the
  // Set-Cookie-only attributes (Path, HttpOnly, SameSite, ...).
  return setCookie.split(";")[0];
}

/** `fetch` against the running app, with an optional session cookie and JSON body. */
function request(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reads the response body exactly once (a `Response` body can only be
 * consumed once; reading it again to build an assertion message after
 * already parsing it as JSON throws "Body is unusable"), asserts the status,
 * and returns the parsed JSON for the caller to use.
 */
async function expectStatus(res: Response, status: number): Promise<unknown> {
  const text = await res.text();
  if (res.status !== status) {
    throw new Error(`expected ${status}, got ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

/** Creates a cleaner account (via the admin-only route) and logs in as them. */
async function createAndLoginCleaner(adminCookie: string): Promise<{ userId: number; cookie: string }> {
  const username = uniqueName("http-cleaner");
  const password = "password123";
  const res = await request("/api/cleaners", {
    method: "POST",
    cookie: adminCookie,
    body: { username, password },
  });
  const body = (await expectStatus(res, 201)) as { user_id: number };
  const cookie = await login(username, password);
  return { userId: body.user_id, cookie };
}

async function createProperty(adminCookie: string): Promise<number> {
  const res = await request("/api/properties", {
    method: "POST",
    cookie: adminCookie,
    body: { name: uniqueName("Property"), address: "1 Example St" },
  });
  const body = (await expectStatus(res, 201)) as { id: number };
  return body.id;
}

let adminCookie: string;

beforeAll(async () => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD are not set in this test process's " +
        "environment. The server needs these set BEFORE it boots to seed an admin " +
        "account (src/auth/seed.ts) — set them, restart the server, and re-run " +
        "`pnpm check` with the same two vars exported. See the comment above " +
        "ADMIN_USERNAME in this file: as of this task, .github/workflows/checks.yml's " +
        "`docker run` step does not set these for CI, which is a real gap, not " +
        "something this test file can paper over.",
    );
  }
  adminCookie = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
});

describe("admin-only routes", () => {
  it("rejects a logged-in cleaner session with 403", async () => {
    const { cookie } = await createAndLoginCleaner(adminCookie);
    const res = await request("/api/properties", {
      method: "POST",
      cookie,
      body: { name: "Should not be created", address: "nowhere" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects no session with 401", async () => {
    const res = await request("/api/properties", {
      method: "POST",
      body: { name: "Should not be created", address: "nowhere" },
    });
    expect(res.status).toBe(401);
  });
});

describe("claiming a property", () => {
  it("409s when a second cleaner claims an already-claimed property", async () => {
    const propertyId = await createProperty(adminCookie);
    const cleanerA = await createAndLoginCleaner(adminCookie);
    const cleanerB = await createAndLoginCleaner(adminCookie);

    // Both start at rank 'normal' (cap 0) from createCleanerAccount, so give
    // each a cap via the admin rank-override route before claiming.
    for (const cleaner of [cleanerA, cleanerB]) {
      const rankRes = await request(`/api/cleaners/${cleaner.userId}/rank`, {
        method: "POST",
        cookie: adminCookie,
        body: { rank: "awesome" },
      });
      expect(rankRes.status, await rankRes.text()).toBe(200);
    }

    const first = await request("/api/picks", {
      method: "POST",
      cookie: cleanerA.cookie,
      body: { property_id: propertyId },
    });
    expect(first.status, await first.text()).toBe(201);

    const second = await request("/api/picks", {
      method: "POST",
      cookie: cleanerB.cookie,
      body: { property_id: propertyId },
    });
    expect(second.status).toBe(409);
  });
});

describe("rank cap enforcement", () => {
  it("400s a fresh (rank 'normal', cap 0) cleaner's first claim attempt", async () => {
    const propertyId = await createProperty(adminCookie);
    const cleaner = await createAndLoginCleaner(adminCookie);

    const res = await request("/api/picks", {
      method: "POST",
      cookie: cleaner.cookie,
      body: { property_id: propertyId },
    });
    expect(res.status).toBe(400);
  });
});
