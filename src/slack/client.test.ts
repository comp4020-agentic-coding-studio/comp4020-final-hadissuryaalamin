import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postThreadReply } from "./client";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("postThreadReply", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
    vi.stubEnv("SLACK_TEST_STUB", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts to chat.postMessage with auth header and JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await postThreadReply("C123", "1700000000.000100", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer xoxb-test-token");
    expect(init.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(init.body)).toEqual({
      channel: "C123",
      thread_ts: "1700000000.000100",
      text: "hello",
    });
  });

  it("throws an error carrying Slack's error code on ok:false", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "channel_not_found" }));

    await expect(postThreadReply("C123", "1.1", "hi")).rejects.toThrow(/channel_not_found/);
  });

  it("does not put the token in the thrown error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "invalid_auth" }));

    await expect(postThreadReply("C123", "1.1", "hi")).rejects.not.toThrow(/xoxb-test-token/);
  });

  it("makes no network call under SLACK_TEST_STUB=1", async () => {
    vi.stubEnv("SLACK_TEST_STUB", "1");

    await postThreadReply("C123", "1.1", "hi");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
