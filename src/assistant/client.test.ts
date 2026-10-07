// Unit tests for the Anthropic tool-use loop (task 003). The Anthropic SDK
// is fully mocked below — no real network call happens anywhere in this
// file, and ANTHROPIC_AUTH_TOKEN is deliberately left unset throughout to
// prove the loop never needs it to run under test.

import type Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const constructorMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // A regular function, not an arrow function: client.ts does `new Anthropic(...)`,
  // and arrow functions aren't constructable.
  return {
    default: vi.fn().mockImplementation(function (this: unknown, options: unknown) {
      constructorMock(options);
      return { messages: { create: createMock } };
    }),
  };
});

// Imported after the mock above so client.ts picks up the mocked SDK.
const { runAssistant } = await import("./client.ts");
const { createConnection } = await import("../db/connection.ts");

function insertUser(db: Database.Database, username: string, role: "cleaner" | "admin"): number {
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, "hash", role);
  return Number(result.lastInsertRowid);
}

function insertCleaner(db: Database.Database, username: string): number {
  const userId = insertUser(db, username, "cleaner");
  db.prepare("INSERT INTO cleaners (user_id, rank) VALUES (?, ?)").run(userId, "normal");
  return userId;
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

function toolUseResponse(id: string, name: string, extraText?: string) {
  const content: unknown[] = [{ type: "tool_use", id, name, input: {} }];
  if (extraText) {
    content.unshift({ type: "text", text: extraText });
  }
  return { content, stop_reason: "tool_use" };
}

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

beforeEach(() => {
  createMock.mockReset();
  constructorMock.mockReset();
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;
});

describe("runAssistant — plain text, no tool use", () => {
  it("returns the model's text reply directly", async () => {
    createMock.mockResolvedValueOnce(textResponse("Hello there, happy to help."));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-1");

    const result = await runAssistant("hi", { db, role: "cleaner", userId });

    expect(result).toBe("Hello there, happy to help.");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("builds the client from env vars, with no token required", async () => {
    createMock.mockResolvedValueOnce(textResponse("ok"));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-2");

    await runAssistant("hi", { db, role: "cleaner", userId });

    expect(constructorMock).toHaveBeenCalledWith({ baseURL: undefined, apiKey: undefined });
  });

  it("sends the role-scoped tool set and a system prompt naming the read-only boundary", async () => {
    createMock.mockResolvedValueOnce(textResponse("ok"));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-3");

    await runAssistant("hi", { db, role: "cleaner", userId });

    const call = createMock.mock.calls[0][0];
    expect(call.tools.map((t: { name: string }) => t.name)).toEqual([
      "get_my_status",
      "get_leaderboard",
      "get_properties",
    ]);
    expect(call.system).toContain("cleaner");
    expect(call.system.toLowerCase()).toContain("can't");
  });
});

describe("runAssistant — one tool-use round trip", () => {
  it("runs the tool and returns the post-tool-result text", async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse("toolu_1", "get_my_status"))
      .mockResolvedValueOnce(textResponse("You're ranked normal with no score yet."));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-4");

    const result = await runAssistant("how am I doing?", { db, role: "cleaner", userId });

    expect(result).toBe("You're ranked normal with no score yet.");
    expect(createMock).toHaveBeenCalledTimes(2);

    const secondCallMessages = createMock.mock.calls[1][0].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(toolResultMessage.role).toBe("user");
    expect(toolResultMessage.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
    });
  });
});

describe("runAssistant — round-trip cap", () => {
  it("stops after 6 round trips and returns a took-too-long message when no text ever arrived", async () => {
    createMock.mockImplementation(async () => toolUseResponse("toolu_x", "get_leaderboard"));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-5");

    const result = await runAssistant("keep going forever", { db, role: "cleaner", userId });

    expect(createMock).toHaveBeenCalledTimes(6);
    expect(result).toBe("took too long to answer, try a simpler question");
  });

  it("returns the best-effort text produced on the capped-out round, if any", async () => {
    createMock.mockImplementation(async () =>
      toolUseResponse("toolu_y", "get_leaderboard", "still working on it..."),
    );
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-6");

    const result = await runAssistant("keep going forever", { db, role: "cleaner", userId });

    expect(createMock).toHaveBeenCalledTimes(6);
    expect(result).toBe("still working on it...");
  });
});

describe("runAssistant — SDK errors never leak", () => {
  it("surfaces a plain message instead of the raw SDK error", async () => {
    createMock.mockRejectedValueOnce(new Error("ECONNREFUSED: connect failed to proxy"));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-7");

    await expect(runAssistant("hi", { db, role: "cleaner", userId })).rejects.toThrow(
      "Could not reach the assistant right now.",
    );
  });

  it("never includes the original error's message", async () => {
    createMock.mockRejectedValueOnce(new Error("401 Unauthorized: invalid x-api-key"));
    const db = createConnection(":memory:");
    const userId = insertCleaner(db, "cleaner-8");

    try {
      await runAssistant("hi", { db, role: "cleaner", userId });
      expect.unreachable("runAssistant should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Could not reach the assistant right now.");
      expect((err as Error).message).not.toContain("Unauthorized");
      expect((err as Error).message).not.toContain("x-api-key");
    }
  });
});
