import { beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuth, requireRole } from "./guards.ts";
import { createSessionToken, SESSION_COOKIE_NAME } from "./session.ts";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

function fakeRequest(cookie?: string): FastifyRequest {
  return { headers: { cookie } } as unknown as FastifyRequest;
}

function fakeReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe("requireAuth", () => {
  it("rejects a request with no session cookie", async () => {
    const request = fakeRequest(undefined);
    const reply = fakeReply();
    await requireAuth(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("accepts a request with a valid session cookie and attaches it", async () => {
    const token = createSessionToken({ user_id: 1, role: "cleaner" });
    const request = fakeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    const reply = fakeReply();
    await requireAuth(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(request.session).toEqual({ user_id: 1, role: "cleaner" });
  });
});

describe("requireRole('admin')", () => {
  it("rejects a request with no session with 401", async () => {
    const request = fakeRequest(undefined);
    const reply = fakeReply();
    await requireRole("admin")(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("rejects a cleaner session with 403", async () => {
    const token = createSessionToken({ user_id: 2, role: "cleaner" });
    const request = fakeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    const reply = fakeReply();
    await requireRole("admin")(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it("accepts an admin session", async () => {
    const token = createSessionToken({ user_id: 3, role: "admin" });
    const request = fakeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    const reply = fakeReply();
    await requireRole("admin")(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(request.session).toEqual({ user_id: 3, role: "admin" });
  });
});
