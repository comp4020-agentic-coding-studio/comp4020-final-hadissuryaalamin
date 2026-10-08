// Anthropic tool-use loop: epic.md "assistant" section, task 003. Wraps
// task 002's TOOLS_FOR_ROLE/runTool (src/assistant/tools.ts) in a
// request/tool-call/response loop against the Anthropic Messages API. The
// system prompt describes the propose/confirm two-step pattern (task 003/004's
// propose_*/execute_pending_action/cancel_pending_action tools) so the model
// knows claiming, releasing, and file-based batch actions ARE available, just
// gated behind an explicit confirmation in a later message.

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { runTool, TOOLS_FOR_ROLE, type RunToolContext } from "./tools.ts";
import { getProposal } from "./proposals.ts";
import { recordUsage } from "./usage.ts";

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
    `You have access to these tools: ${toolNames}. Use the get_*/propose_*`,
    `tools to look up data or validate an action -- never guess at data you`,
    `could look up.`,
    `A propose_* tool only validates and stages an action (like claiming or`,
    `releasing a property, or a file-based batch); it never changes anything`,
    `by itself. After a propose_* call succeeds, relay its description back`,
    `to the user and wait for their reply. Call execute_pending_action only`,
    `once the user's latest message is a clear, unambiguous yes to the exact`,
    `pending action you just described. Call cancel_pending_action if they`,
    `clearly decline. If their message is unrelated to a pending proposal,`,
    `ignore it and answer the new message normally instead of executing or`,
    `cancelling anything.`,
    `If asked to do something none of your tools support, say plainly that`,
    `you can't do that -- do not attempt a workaround.`,
    `Reply in plain text only — no markdown (no **bold**, no # headers, no`,
    `bullet lists with * or -). Replies are shown as plain text, so markdown`,
    `syntax would show up as literal asterisks and hashes. Use plain`,
    `sentences or numbered lines ("1. ...", "2. ...") instead.`,
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

  // Each call is a brand-new, stateless conversation -- re-derive pending-proposal
  // context (task 001's in-memory store) fresh every time and fold it into the
  // system prompt, rather than carrying any message history across requests.
  const pending = getProposal(ctx.userId);
  let system = buildSystemPrompt(ctx.role);
  if (pending) {
    system += [
      ` There is a pending proposed action awaiting confirmation: "${pending.description}".`,
      ` If the user's latest message is a clear, unambiguous yes, call execute_pending_action.`,
      ` If it is a clear no, call cancel_pending_action. If the message is unrelated to this`,
      ` proposal, ignore the pending action and answer the new message normally.`,
    ].join("");
  }

  const messages: MessageParam[] = [{ role: "user", content: message }];
  let lastText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    for (let round = 0; round < MAX_ROUND_TRIPS; round++) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
      });

      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;

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
            // block.input carries the model's actual tool-call arguments
            // (e.g. property_id) -- must be forwarded, or every input-taking
            // tool (propose_claim_property, propose_release_property) always
            // sees `undefined` and fails with "I need a valid ...". Found via
            // task 008's real end-to-end check (spec/assistant.test.ts's
            // ASSISTANT_TEST_STUB path never exercises this, since it never
            // reaches a real tool call).
            const result = await runTool(block.name, ctx, block.input as Record<string, unknown> | undefined);
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
  } finally {
    recordUsage(ctx.db, {
      userId: ctx.userId,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });
  }
}
