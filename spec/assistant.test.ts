import { beforeAll, describe, expect, inject, it } from "vitest";

// HTTP-contract tests for POST /api/assistant (task 006), same running-server
// pattern as spec/http.test.ts: talks to the real app over HTTP, baseUrl from
// spec/global-setup.ts.
//
// Critical constraint: this file must NEVER cause a real call to the
// Anthropic API/strproxy. It relies entirely on src/assistant/client.ts's
// ASSISTANT_TEST_STUB seam — runAssistant returns a canned string and never
// constructs an Anthropic client when `process.env.ASSISTANT_TEST_STUB` is
// "1". That flag belongs to the SERVER process under test, not to this test
// process: whoever boots the server for spec/ must set
// ASSISTANT_TEST_STUB=1 (and SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD, per
// spec/http.test.ts) before it starts, e.g.:
//   ASSISTANT_TEST_STUB=1 SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=admin-password node src/server.ts
//
// KNOWN GAP, same shape as the one spec/http.test.ts documents for
// SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD: as of this task,
// .github/workflows/checks.yml's `docker run` step sets neither
// ASSISTANT_TEST_STUB nor the SEED_ADMIN_* vars, so a real CI run never
// reaches the stub at all — the admin login in beforeAll below fails first.
// Fixing the CI workflow is out of this task's scope (it isn't owned by
// task 006 and risks colliding with other in-flight work); flagging it here
// so it's visible to whoever wires up CI env for this epic.
const baseUrl = inject("baseUrl");

const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const STUBBED_REPLY = "stubbed reply for tests";

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
        `were set BEFORE the server booted.`,
    );
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`login as "${username}" returned 200 but no set-cookie header`);
  }
  return setCookie.split(";")[0];
}

function postAssistant(body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return fetch(new URL("/api/assistant", baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

let adminCookie: string;

beforeAll(async () => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD are not set in this test process's " +
        "environment. The server needs these set BEFORE it boots to seed an admin " +
        "account (src/auth/seed.ts) — set them, restart the server (also with " +
        "ASSISTANT_TEST_STUB=1, see the comment at the top of this file), and " +
        "re-run `pnpm check` with the same two vars exported.",
    );
  }
  adminCookie = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
});

describe("POST /api/assistant", () => {
  it("rejects no session with 401", async () => {
    const res = await postAssistant({ message: "what is my status?" });
    expect(res.status).toBe(401);
  });

  it("200s for the logged-in admin with the stubbed reply, proving route wiring end to end", async () => {
    const res = await postAssistant({ message: "what is on the leaderboard?" }, adminCookie);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const body = JSON.parse(text) as { reply?: string };
    expect(body.reply).toBe(STUBBED_REPLY);
  });

  it("400s an empty message", async () => {
    const res = await postAssistant({ message: "" }, adminCookie);
    expect(res.status).toBe(400);
  });

  it("400s a message over 2000 characters", async () => {
    const res = await postAssistant({ message: "a".repeat(2001) }, adminCookie);
    expect(res.status).toBe(400);
  });
});
