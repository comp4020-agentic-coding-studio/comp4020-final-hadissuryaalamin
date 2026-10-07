# LLM assistant (pass 1: read-only Q&A) — design

## Why

The user asked for an LLM assistant embedded in the app that can answer
questions ("what is my cleaner score") through to, eventually, more complex
action sequences — while the manual UI stays fully available for anyone who
prefers clicking buttons over chatting. This document covers **pass 1 only**:
read-only Q&A, both roles, no write actions. Write actions (claim/release a
property, enter a review batch), confirm-gated before executing, are an
explicit later pass.

## Scope confirmed with the user

- Both roles (Cleaner, Admin) get the assistant, each scoped to what their
  role can already see.
- Chat lives on a new page, `public/home.html`, which becomes the post-login
  landing for both roles — full ChatGPT/Claude-style layout (message bubbles,
  input at bottom), plain HTML/CSS/vanilla JS only (`CLAUDE.md` bans any
  framework/bundler in `public/`, and bans ambient/decorative animation).
- Existing pages are unchanged and reachable from `home.html` via nav links.
- LLM calls go through the course strproxy key (same `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_AUTH_TOKEN` Claude Code itself uses) — shares the weekly course
  budget, must be set as Fly secrets on the deployed app by hand.
- Automated tests never call the real API — the Anthropic client is mocked
  everywhere in `pnpm check`/CI.

## Architecture

1. **Extract read-only query functions** out of the existing route handlers
   (`getMyStatus`, `getLeaderboard`, `getPropertiesList` in
   `src/api/cleaner.ts`; `getReviewsSummary` in `src/api/admin.ts`) so the
   assistant's tools and the HTTP routes share one implementation. No
   behavior change to any existing route.
2. **`src/assistant/tools.ts`** — Anthropic tool-use schemas plus
   `runTool(name, ctx)`, role-scoped: a cleaner session can only reach
   `get_my_status`/`get_leaderboard`/`get_properties`; an admin session can
   only reach `get_leaderboard`/`get_properties`/`get_reviews_summary`. No
   write tools exist in this module.
3. **`src/assistant/client.ts`** — wraps `@anthropic-ai/sdk`, builds a system
   prompt stating the role and the read-only boundary, runs the tool-use
   loop (capped at 6 round trips), returns final text. Any SDK error is
   caught and turned into a plain, legible message — never a raw stack
   trace.
4. **`POST /api/assistant`** (new `src/api/assistant.ts`) — authed,
   `{ message }` in, `{ reply }` or `{ error }` out. Role inferred the same
   way the rest of the API already infers it (cleaner row present or not).
5. **`public/home.html`** — the chat UI, plus `public/index.html`'s
   `destinationFor()` updated to land both roles here after login instead of
   going straight to `cleaner.html`/`admin.html`.

## Out of scope for pass 1

Write actions via the assistant, multi-step chains, setting the Fly
secrets (done manually post-merge), any change to the already-shipped
real-time/WebSocket layer.

## Testing

Unit tests for `tools.ts`'s role-scoping and `client.ts`'s loop logic (SDK
fully mocked). `spec/` contract coverage for `POST /api/assistant`'s auth
boundary and validation, with the assistant client stubbed at the process
level so the contract suite never calls the real API.
