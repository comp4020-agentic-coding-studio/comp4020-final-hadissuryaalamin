# LLM assistant pass 2: write actions, file upload, usage tracking

## Why

Pass 1 shipped a read-only chat assistant. The user asked for the next
step: the assistant should be able to claim/release a property, read an
uploaded CSV (reviews, cleaners, or properties) and act on it, and an
admin should be able to see how much this feature itself has used of the
course LLM budget. This document is the design for that pass.

## Confirm mechanism: natural language, server-bounded

The user chose natural-language confirmation over a button UI: the
assistant proposes an action in plain text, and the next message is
interpreted by the model as yes/no. To bound the risk of a misread reply,
the server stores the exact proposed action and the execute tool can only
ever run that exact stored action — the model's judgement decides
whether to execute, never what gets executed. Executing always clears the
pending slot first, so a retry or double-confirm cannot double-apply
anything.

## Stateless requests, server-replayed context

Each POST /api/assistant call is a fresh, history-free model conversation.
A propose -> confirm flow spans two separate HTTP requests, so the model
cannot remember its own proposal from request to request on its own. The
fix: the server stores a human-readable description alongside each
proposal and re-injects it into the system prompt on every subsequent
call until the proposal is confirmed, cancelled, or expires (5 minutes).
The model only ever sees "here is what's pending" restated fresh each
time — no growing conversation history, no client-resent transcript.

## New tools

Cleaner: propose_claim_property, propose_release_property.
Admin: propose_review_batch_from_file, propose_create_cleaners_from_file,
propose_create_properties_from_file (each reads an attached file directly
from the request, never from model-transcribed text).
Both roles: execute_pending_action, cancel_pending_action.

## File upload

Admin-only. The browser reads the attached file as text and sends it
alongside the chat message; the model never sees the raw file content,
only a structured summary from the propose tool. CSV formats match the
app's existing reviews-CSV convention (plain two-column comma values, no
quoted fields): username,stars / username,password / name,address.

## Usage tracking

Every Anthropic response reports input/output token counts. The app
accumulates these per request and stores them in a new assistant_usage
table; an admin-only endpoint and a small admin.html section surface the
running totals (no dollar estimate — model pricing isn't stable enough
to hardcode).

## Out of scope

Admin-side rank override via chat, multi-step chained write actions
beyond one proposal at a time, and any confirm UI beyond plain chat text.
