// Anthropic tool-use loop: epic.md "assistant" section, task 003. Wraps
// task 002's TOOLS_FOR_ROLE/runTool (src/assistant/tools.ts) in a
// request/tool-call/response loop against the Anthropic Messages API.
// Read-only: the system prompt tells the model plainly that it cannot
// claim/release properties, enter reviews, or change rank yet.

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { runTool, TOOLS_FOR_ROLE, type RunToolContext } from "./tools.ts";

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_ROUND_TRIPS = 6;
const MAX_TOKENS = 1024;
const TOO_SLOW_TEXT = "took too long to answer, try a simpler question";
const UNREACHABLE_TEXT = "Could not reach the assistant right now.";

function buildSystemPrompt(role: RunToolContext["role"]): string {
  const toolNames = TOOLS_FOR_ROLE[role].map((tool) => tool.name).join(", ");
  return [
    `You are the assistant for a cleaner performance & property preference app.`,
    `You are talking to a user with the "${role}" role.`,
    `You have read-only access to these tools: ${toolNames}. Use them to answer`,
    `questions about status, the leaderboard, properties, or reviews — never`,
    `guess at data you could look up.`,
    `You cannot claim or release properties, enter reviews, or change anyone's`,
    `rank yet. If asked to do any of those things, say plainly that you can't`,
    `do that yet — do not attempt a workaround.`,
  ].join(" ");
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Runs one user message through the Anthropic tool-use loop, scoped to
 * `ctx.role`'s own tools (see `TOOLS_FOR_ROLE`/`runTool` in ./tools.ts).
 * Resolves to the assistant's final text reply; never throws a raw SDK
 * error (see the catch below) and never exceeds `MAX_ROUND_TRIPS` calls to
 * the API.
 */
export async function runAssistant(message: string, ctx: RunToolContext): Promise<string> {
  // Test-only stub (task 006/008): short-circuits before the Anthropic client
  // is ever constructed, so spec/'s HTTP contract tests can exercise the full
  // POST /api/assistant route — auth, validation, response shape — against a
  // real running server without spending real course budget or needing
  // ANTHROPIC_AUTH_TOKEN at all. Only the server process spec/ boots sets
  // this; never set it for a real deploy.
  if (process.env.ASSISTANT_TEST_STUB === "1") {
    return "stubbed reply for tests";
  }

  const client = new Anthropic({
    baseURL: process.env.ANTHROPIC_BASE_URL,
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
  });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const tools = TOOLS_FOR_ROLE[ctx.role];
  const system = buildSystemPrompt(ctx.role);

  const messages: MessageParam[] = [{ role: "user", content: message }];
  let lastText = "";

  try {
    for (let round = 0; round < MAX_ROUND_TRIPS; round++) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
      });

      const text = extractText(response.content);
      if (text) {
        lastText = text;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (toolUseBlocks.length === 0) {
        return lastText;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            const result = await runTool(block.name, ctx);
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            };
          } catch (err) {
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content: err instanceof Error ? err.message : String(err),
              is_error: true,
            };
          }
        }),
      );

      messages.push({ role: "user", content: toolResults });
    }

    return lastText || TOO_SLOW_TEXT;
  } catch (err) {
    throw new Error(UNREACHABLE_TEXT);
  }
}
