import { beforeAll, describe, expect, inject, it } from "vitest";
import { WebSocket } from "ws";

// WebSocket-layer contract tests — task 006. Same running-instance pattern
// as spec/http.test.ts (fetch against `baseUrl`, same admin-seed login
// requirement/known-CI-gap), plus a `ws` client connected with a valid
// session cookie to assert the broadcasts src/realtime/broadcast.ts sends
// actually arrive over the wire. Helpers below are intentionally duplicated
// from spec/http.test.ts rather than shared, matching that file's own
// "self-contained spec file" style.
const baseUrl = inject("baseUrl");

const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

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
        `were set BEFORE the server booted (see spec/http.test.ts).`,
    );
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`login as "${username}" returned 200 but no set-cookie header`);
  }
  return setCookie.split(";")[0];
}

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

async function expectStatus(res: Response, status: number): Promise<unknown> {
  const text = await res.text();
  if (res.status !== status) {
    throw new Error(`expected ${status}, got ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

async function createAndLoginCleaner(adminCookie: string): Promise<{ userId: number; cookie: string }> {
  const username = uniqueName("ws-cleaner");
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

/** Gives a cleaner a non-zero cap so they can actually claim something. */
async function setRank(adminCookie: string, userId: number, rank: "legend" | "awesome" | "normal"): Promise<void> {
  const res = await request(`/api/cleaners/${userId}/rank`, {
    method: "POST",
    cookie: adminCookie,
    body: { rank },
  });
  expect(res.status, await res.text()).toBe(200);
}

type RealtimeMessage = { type: string; payload?: unknown };

interface SocketHandle {
  messages: RealtimeMessage[];
  /** Resolves with the first (already-seen or future) message matching `predicate`, or rejects after `timeoutMs`. */
  waitFor(predicate: (msg: RealtimeMessage) => boolean, timeoutMs?: number): Promise<RealtimeMessage>;
  close(): void;
}

/** Opens a `/ws` connection authenticated with `cookie` and collects every message it receives. */
function connectSocket(cookie: string): Promise<SocketHandle> {
  return new Promise((resolve, reject) => {
    const wsUrl = new URL("/ws", baseUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(wsUrl, { headers: { cookie } });

    const messages: RealtimeMessage[] = [];
    const waiters: { predicate: (msg: RealtimeMessage) => boolean; settle: (msg: RealtimeMessage) => void }[] = [];

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as RealtimeMessage;
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          waiters[i].settle(msg);
          waiters.splice(i, 1);
        }
      }
    });

    ws.once("open", () => {
      resolve({
        messages,
        waitFor(predicate, timeoutMs = 3000) {
          const already = messages.find(predicate);
          if (already) return Promise.resolve(already);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.settle === settle);
              if (idx !== -1) waiters.splice(idx, 1);
              rej(
                new Error(
                  `timed out after ${timeoutMs}ms waiting for a matching realtime message; ` +
                    `messages seen so far: ${JSON.stringify(messages)}`,
                ),
              );
            }, timeoutMs);
            const settle = (msg: RealtimeMessage) => {
              clearTimeout(timer);
              res(msg);
            };
            waiters.push({ predicate, settle });
          });
        },
        close: () => ws.close(),
      });
    });
    ws.once("error", reject);
  });
}

/** Waits briefly past `handle`'s first matching message to make sure no duplicate follows. */
async function waitForSettled(handle: SocketHandle, graceMs = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, graceMs));
}

let adminCookie: string;

beforeAll(async () => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD are not set in this test process's " +
        "environment — see the comment above ADMIN_USERNAME in spec/http.test.ts.",
    );
  }
  adminCookie = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
});

describe("realtime broadcasts over /ws", () => {
  it("delivers pick:claimed when a cleaner claims a property", async () => {
    const cleaner = await createAndLoginCleaner(adminCookie);
    await setRank(adminCookie, cleaner.userId, "awesome");
    const propertyId = await createProperty(adminCookie);

    const socket = await connectSocket(cleaner.cookie);
    try {
      const claim = await request("/api/picks", {
        method: "POST",
        cookie: cleaner.cookie,
        body: { property_id: propertyId },
      });
      expect(claim.status, await claim.text()).toBe(201);

      const msg = await socket.waitFor(
        (m) => m.type === "pick:claimed" && (m.payload as { property_id?: number })?.property_id === propertyId,
      );
      expect(msg).toEqual({ type: "pick:claimed", payload: { property_id: propertyId } });
    } finally {
      socket.close();
    }
  });

  it("delivers pick:released when a cleaner releases a claimed property", async () => {
    const cleaner = await createAndLoginCleaner(adminCookie);
    await setRank(adminCookie, cleaner.userId, "awesome");
    const propertyId = await createProperty(adminCookie);

    const claim = await request("/api/picks", {
      method: "POST",
      cookie: cleaner.cookie,
      body: { property_id: propertyId },
    });
    const pick = (await expectStatus(claim, 201)) as { id: number };

    const socket = await connectSocket(cleaner.cookie);
    try {
      const release = await request(`/api/picks/${pick.id}`, {
        method: "DELETE",
        cookie: cleaner.cookie,
      });
      expect(release.status).toBe(204);

      const msg = await socket.waitFor(
        (m) => m.type === "pick:released" && (m.payload as { property_id?: number })?.property_id === propertyId,
      );
      expect(msg).toEqual({ type: "pick:released", payload: { property_id: propertyId } });
    } finally {
      socket.close();
    }
  });

  it("delivers ranks:changed when an admin overrides a cleaner's rank", async () => {
    const cleaner = await createAndLoginCleaner(adminCookie);

    const socket = await connectSocket(adminCookie);
    try {
      await setRank(adminCookie, cleaner.userId, "legend");

      const msg = await socket.waitFor((m) => m.type === "ranks:changed");
      expect(msg).toEqual({ type: "ranks:changed" });
    } finally {
      socket.close();
    }
  });

  it("delivers ranks:changed when an admin posts a review batch", async () => {
    const cleaner = await createAndLoginCleaner(adminCookie);

    const socket = await connectSocket(adminCookie);
    try {
      const res = await request("/api/reviews/batch", {
        method: "POST",
        cookie: adminCookie,
        body: [{ cleaner_id: cleaner.userId, stars: 5 }],
      });
      expect(res.status, await res.text()).toBe(200);

      const msg = await socket.waitFor((m) => m.type === "ranks:changed");
      expect(msg).toEqual({ type: "ranks:changed" });
    } finally {
      socket.close();
    }
  });
});

describe("single-winner race invariant, with the broadcast layer in place", () => {
  it("two concurrent claims on the same property produce exactly one 201, one 409, and exactly one pick:claimed broadcast", async () => {
    const cleanerA = await createAndLoginCleaner(adminCookie);
    const cleanerB = await createAndLoginCleaner(adminCookie);
    await setRank(adminCookie, cleanerA.userId, "awesome");
    await setRank(adminCookie, cleanerB.userId, "awesome");
    const propertyId = await createProperty(adminCookie);

    // A third party's socket — neither racer's own cookie — so this only
    // relies on the broadcast fan-out, not on which racer's connection
    // happens to be registered.
    const socket = await connectSocket(adminCookie);
    try {
      const [resA, resB] = await Promise.all([
        request("/api/picks", { method: "POST", cookie: cleanerA.cookie, body: { property_id: propertyId } }),
        request("/api/picks", { method: "POST", cookie: cleanerB.cookie, body: { property_id: propertyId } }),
      ]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const matches = (m: RealtimeMessage) =>
        m.type === "pick:claimed" && (m.payload as { property_id?: number })?.property_id === propertyId;

      await socket.waitFor(matches);
      // Give a second, spurious broadcast (if the race invariant were
      // broken) a chance to arrive before asserting there's exactly one.
      await waitForSettled(socket);
      expect(socket.messages.filter(matches)).toHaveLength(1);
    } finally {
      socket.close();
    }
  });
});
