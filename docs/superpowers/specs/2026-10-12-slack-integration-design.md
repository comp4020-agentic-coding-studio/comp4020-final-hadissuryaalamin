# Slack integration for the assistant — design

## Why

The assistant (pass 1 + pass 2) already lets a cleaner claim/release a
property through an in-app chat, with a propose-then-confirm flow for
safety. The user wants a second entry point: a Slack channel where
Legend/Awesome-tier cleaners can ask for their preferred property, with
the same LLM-driven propose/confirm exchange happening as thread replies
in Slack instead of in the web chat.

## Scope confirmed with the user

- Identity: an Admin maps each cleaner's Slack user ID to their existing
  cleaner account (new field, no new account type, no self-service
  linking flow — matches `CLAUDE.md`'s "every account created by Admin"
  rule).
- Safety: Slack requests go through the exact same propose → confirm →
  execute flow as the in-app assistant. No auto-execute on first message.
- Ingestion: Slack Events API webhook (push), not polling. The app is
  already deployed with a public Fly URL.
- Reply style: thread replies on the cleaner's own message, not flat
  channel messages — keeps concurrent cleaners' exchanges visually
  separated.
- Unmapped sender: the bot replies with a legible error ("Slack account
  isn't linked — ask an Admin"), consistent with the app's existing rule
  that every triggerable error gets a message, never silence.
- Workspace: the user doesn't control the Slack workspace they're
  currently a member of, so this targets a new workspace the user owns,
  created for this project. Tokens come from a fresh Slack App created
  there — not the tokens from the other workspace.

## Architecture

A new `src/slack/` module is a thin adapter in front of the existing
`src/assistant/*` core. No change to the assistant's tools, the
propose/confirm/execute logic, or `proposals.ts`'s in-memory store.

## Components

1. **`POST /api/slack/events`** (new `src/api/slack.ts`) — the webhook
   route.
   - Verifies `X-Slack-Signature` / `X-Slack-Request-Timestamp` as an
     HMAC-SHA256 over the raw body, keyed by `SLACK_SIGNING_SECRET`.
     Also rejects stale timestamps (>5 minutes old) to block replay.
     Any failure → 401, nothing processed.
   - Handles Slack's one-time `url_verification` challenge (echoes back
     the `challenge` field) for initial Events API setup.
   - Dedupes by Slack's `event_id`: an in-memory `Map` with a short TTL,
     same pattern as `proposals.ts`. Slack retries a webhook that
     doesn't ack fast enough; a replayed `event_id` is a no-op.
   - Ignores events from the bot's own `bot_id` (no self-triggering
     loops) and anything outside the configured `SLACK_CHANNEL_ID`.
2. **`src/slack/client.ts`** — wraps the Slack Web API's
   `chat.postMessage`, used only to post thread replies
   (`thread_ts` = the triggering message's `ts`). Holds
   `SLACK_BOT_TOKEN`.
3. **`cleaners.slack_user_id`** — new nullable, unique column. Admin
   sets it per cleaner; small addition to `admin.html`'s existing
   cleaner list/edit UI and the cleaner create/edit route.
4. **Glue** (in the webhook route): on a verified, deduped, in-channel
   message —
   - Look up the cleaner by `slack_user_id`.
   - Not found → post a thread reply with the "not linked" message,
     stop. No assistant call.
   - Found → build the same `ctx` the HTTP assistant route builds, with
     role **forced to `"cleaner"`** regardless of any other data —
     Slack is a cleaner-facing surface only, never admin, even if a
     mapped id somehow belonged to an admin-capable account. Run the
     existing assistant core on the message text. Post the reply as a
     thread reply.

## Data flow

Cleaner posts in the channel → Slack signs and POSTs the event →
signature check → timestamp freshness check → dedupe check → channel-id
check → `slack_user_id` → cleaner lookup → assistant core runs with the
cleaner's existing tool set (`get_my_status`, `get_leaderboard`,
`get_properties`, `propose_claim_property`, `propose_release_property`,
`execute_pending_action`, `cancel_pending_action`) → reply posted as a
thread reply.

Pending proposals use the existing `proposals.ts` store unchanged, keyed
by the cleaner's numeric id exactly as today. A cleaner could propose a
claim over Slack and confirm it in the in-app web chat (or vice versa) —
the store doesn't distinguish which surface made each call.

## Error handling

- Invalid/missing signature, or stale timestamp → 401, no processing,
  nothing logged beyond the rejection.
- Unmapped `slack_user_id` → thread reply with a legible "ask an Admin"
  message, no assistant/LLM call made.
- Assistant/SDK error → the existing catch-all turns it into plain text
  (never a raw stack trace), posted to the thread.
- Slack API error while posting the reply → logged server-side only;
  there's no way to surface a Slack-posting failure inside Slack itself.

## Testing

- Unit tests (`src/slack/`): signature verification (valid, invalid,
  stale timestamp), event-id dedupe, channel-id filter, `slack_user_id`
  → cleaner lookup.
- `spec/` contract test for `POST /api/slack/events`: the
  `url_verification` handshake, a validly-signed event driving a mocked
  assistant call, an unmapped sender getting the error reply, and a
  replayed `event_id` being a no-op. The Slack client (`chat.postMessage`)
  is mocked everywhere in `pnpm check`/CI, the same pattern already used
  for the Anthropic client.

## Secrets

`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, and `SLACK_CHANNEL_ID` are set
as Fly secrets on the deployed app by hand, the same way
`ANTHROPIC_AUTH_TOKEN` already is. Never committed, never logged.

## Out of scope

Admin-role access via Slack (the channel is cleaner-only by design),
multi-channel support, Slack slash commands, file upload via Slack, and
DMs. All matching the existing assistant's "no scope the brief doesn't
call for" rule from `CLAUDE.md`.
