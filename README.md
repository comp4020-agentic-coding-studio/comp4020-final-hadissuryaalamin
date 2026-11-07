# Cleaner Performance & Property Preference

## What this is

This is an internal tool for one short-stay accommodation business. It has two
kinds of users: an Admin, who enters monthly review batches and manages the
property list, and a handful of Cleaners, who check their rank and claim the
properties they want to keep cleaning. Nobody outside that business will ever
have an account. There is no sign-up flow, no onboarding tour, no marketing
copy, because there is no stranger to market to.

Live at <https://comp4020-final-hadissuryaalamin.fly.dev>.

## For the marker

Log in as Admin at the link above with:

- **Username:** `admin`
- **Password:** `admin12345`

From the Admin account, open the Cleaners page and add one or two Cleaner
accounts (any username/password you like) — that takes a few seconds. A new
Cleaner starts normal with no free slots, so they can't claim anything yet:
on the same page, use **Override a rank** to set the new account to legend
(5 slots) or awesome (3 slots) before trying to claim a property. Then, in a
second Chrome profile (or incognito window), log in as one of those Cleaners
alongside the Admin session: claiming/releasing a property as the Cleaner and
running a review batch as the Admin both broadcast to every open page within
about a second, which is the multi-user and real-time behaviour to look for.
Two Cleaner accounts (both overridden to legend/awesome) in two separate
profiles also show the claim race (only one wins, the other gets "Property
already claimed").
No install step or command is needed; everything else below is background
reading, not a prerequisite for marking.

### Trying the Slack entry point

The same claim/release actions are also reachable from a linked Cleaner's
Slack messages, in plain words. To try it:

1. Join the workspace: <https://join.slack.com/share/enQtMTI1Mzk4MDEwMzAyMTItYjE2M2M5ZTU4YjVlN2VlMWEzMTE2MWRiMDdlYTg2MjUyMTQ4Y2IxZmVhN2E5ZjViZmY0OTYzZDQwZTk3NGIxOA>
   and open the channel the bot is in.
2. In Slack, click your profile picture → **...** → **Copy member ID**.
3. As Admin, open the Cleaners page, edit one of the Cleaner accounts you
   made above, and paste that Slack ID into its Slack field.
4. Message the bot in the channel in plain words, e.g. "claim property 3". It
   proposes the action and waits for a "yes" before anything is written —
   nothing executes on the first message.

An unlinked Cleaner's messages just get a "Slack account isn't linked — ask
an Admin" reply, so step 3 is required before step 4 does anything.

## Want to try it?

There's no public sign-up — every account besides the one above is created by
hand by the Admin. If you'd like a Cleaner credential of your own instead of
using the Admin login above, email <hadisssurya@gmail.com>.

## What each person can do

**Cleaners** see the leaderboard, every property and who holds it, and their
own rank, score and free slots. They claim free properties and release their
own claims. A legend gets 5 slots, an awesome 3, a normal cleaner none, so a
new cleaner can't claim anything until their reviews (or the Admin) move them
up.

**The Admin** adds, edits and deletes properties and cleaner accounts, submits
the monthly review batch (typed in, or as a CSV), overrides a rank by hand,
and links a cleaner to their Slack account.

The full rule set, why it is drawn where it is, and where the server checks
each part is in
[`docs/decisions/0002-access-control.md`](docs/decisions/0002-access-control.md).

## Why claim a property at all

The claim system exists to reward good performance with something a cleaner
actually wants, rather than just a number on a leaderboard: first pick of
which properties they keep cleaning. A cleaner who's earned a good rank gets
to settle into properties they know, instead of a different unit every month.
That ownership is also expected to pay back to the business — a cleaner who
keeps the same unit tends to notice small problems earlier and take more
care of it than one rotating through a different property every batch.

## How the ranking works

A cleaner needs at least five reviews in the current period to be scored at
all. Their single lowest review is dropped and the rest are averaged. Scored
cleaners are sorted by score, then by review count, then by whose account
was created first:
the top 15 are legend, the next 10 awesome, everyone else (and everyone
unscored) normal. When a new batch demotes someone, they keep their earliest
claims up to the new cap and lose the rest (legend to awesome keeps slots
1–3 and drops 4 and 5).

## More than one way in

The same actions are reachable three ways: the pages, an assistant on the
home screen, and a Slack channel where a linked cleaner can ask for a property
in plain words. All three call the same functions on the server under the
caller's own account, so the rules above hold whichever one is used. The
assistant proposes a change and waits for a "yes" before anything is written.

Every page updates live: when someone claims or releases a property, or a
review batch moves the ranks, every open page refreshes its data within about
a second.

When two cleaners claim the same property at once, the database decides: the
first insert wins and the other cleaner is told "Property already claimed".
The reasoning is in
[`docs/decisions/0001-claim-race.md`](docs/decisions/0001-claim-race.md).

## Who did what

Every change anyone makes, and every attempt the server refuses, writes one
line to the server log naming the person, for example
`bob (cleaner) claim refused: property 4 "Lakeside Unit 4" (already-claimed) [web]`.
On the deployed app:

```sh
mise exec -- flyctl logs -a comp4020-final-hadissuryaalamin | grep '"audit":true'
```

## What good means here

Good, for this app, is not "looks like a SaaS admin panel." A generic
dashboard template would actually be the wrong shape: it would spend effort
on things this business doesn't have (multi-tenant billing, a help centre,
a settings page nobody asked for) and under-spend on the two things that
actually matter — the ranking math being right, and a claimed property
staying claimed under two cleaners clicking at once.

That framing comes from reading, not from the brief's own wording. Robin
Sloan's notes on building ["home-cooked" software](https://www.robinsloan.com/notes/home-cooked-app/)
for an audience of family and close friends argue that software scoped to a
small, known group can skip almost everything a public product needs and
spend that saved effort on fit instead. Anna Anthropy's
*Rise of the Videogame Zinesters* makes a parallel case for games built by
one person for a handful of players rather than a mass market: the point
isn't production value, it's that the maker can actually see who it's for.
Tom Critchlow's ["small b blogging"](https://tomcritchlow.com/2019/05/30/small-b-blogging/)
essay and Yancey Strickler's
["The Dark Forest Theory of the Internet"](https://onezero.medium.com/the-dark-forest-theory-of-the-internet-7dc3e68a7cb1)
both describe a retreat from broad-audience, public-internet software toward
small, legible spaces built for people who already know each other — which
is closer to what an internal cleaner-management tool actually is than
anything aimed at the open web.

So "good" here means: an Admin can run a monthly review batch and trust the
rank it produces without re-deriving the arithmetic by hand, and a Cleaner
can look at the property list and immediately tell what's theirs, what's
free, and what they lost out on by a few seconds. It does not mean polish
for polish's sake, and it does not mean generality the business doesn't need.

## What the tests enforce

The tests check the parts where "good" has one correct answer. Unit tests
next to the code in `src/` cover the scoring rule (drop-one-lowest, the
five-review floor), the 15/legend, 10/awesome leaderboard cut and its
tie-break, slot caps and which slots a demotion drops, the assistant's tools,
and that the who-did-what log names people and never carries a password.
`spec/` runs against the live server: a race for the same property only ever
has one winner and one broadcast, and the auth boundaries hold — an
admin-only route rejecting a cleaner session, a cleaner only ever acting on
their own picks. `pnpm check` runs both.

## What a person has to judge

Whether the leaderboard and pick screens are actually readable at a glance,
whether an error (a 409 on a claimed property, a rejected admin action) is
legible to the person who hit it, and whether the whole thing reads as a
tool built for five people rather than five thousand — none of that has a
single correct answer a test can assert. That's left to the crit and the
marker, same as the brief says.

## Running it

Node 24 and pnpm, pinned in `mise.toml`.

```sh
pnpm install
SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=... pnpm start
```

The server listens on port 8080 and keeps its SQLite database in
`data/app.db` (on Fly, the `/data` volume). The two `SEED_ADMIN_*` variables
create the first Admin on an empty database; after that the Admin creates
everyone else. The assistant needs `ANTHROPIC_AUTH_TOKEN` (and
`ANTHROPIC_BASE_URL` for the course proxy); Slack needs `SLACK_BOT_TOKEN`,
`SLACK_SIGNING_SECRET` and `SLACK_CHANNEL_ID`. On Fly these are set with
`flyctl secrets set`, along with `SESSION_SECRET` so sign-ins survive a
restart.

`pnpm check` runs the typecheck, the unit tests, and `spec/` against a server
already running on port 8080. Pushing to `main` runs the same checks in CI and
deploys to Fly if they pass. `PROCESS.md` tells how the app was built.

## Setting up the assistant (LLM)

The assistant is a thin wrapper (`src/assistant/client.ts`) around the
Anthropic API, given a small set of read/propose tools (`get_my_status`,
`get_leaderboard`, `get_properties`, `propose_claim_property`,
`propose_release_property`, `execute_pending_action`,
`cancel_pending_action`) — see `docs/superpowers/specs/` for the original
design. To run it:

1. Get an Anthropic API key, or (this course's setup) the strproxy key and
   base URL from Canvas.
2. Set three env vars before starting the server:
   - `ANTHROPIC_AUTH_TOKEN` — the API key.
   - `ANTHROPIC_BASE_URL` — only needed for a proxy (e.g. the course's
     strproxy); omit for a direct Anthropic key.
   - `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-5`.
3. On Fly: `mise exec -- flyctl secrets set ANTHROPIC_AUTH_TOKEN=... ANTHROPIC_BASE_URL=...`.

No key set → the chat still loads but every message gets a legible
"Could not reach the assistant right now" reply instead of a crash; the
manual pages and buttons keep working regardless.

## Setting up the Slack connection

The Slack channel is a second entry point into the same assistant — a
linked Cleaner can ask for a property in plain words there instead of the
in-app chat. It is cleaner-only (never admin) and uses the same
propose-then-confirm flow, so nothing executes on the first message.

1. Create a Slack workspace and a Slack App in it (the course set this up
   on a workspace the student owns, not a shared one).
2. Under **Event Subscriptions**, point the Request URL at
   `https://<your-fly-app>.fly.dev/api/slack/events` and subscribe to
   `message.channels`. Slack calls this once to verify it (the app answers
   the `url_verification` challenge automatically).
3. Under **OAuth & Permissions**, add the `chat:write` bot scope and
   install the app to the workspace.
4. Create (or reuse) a channel, invite the bot to it, and copy its channel
   ID.
5. Set three Fly secrets:
   `mise exec -- flyctl secrets set SLACK_BOT_TOKEN=... SLACK_SIGNING_SECRET=... SLACK_CHANNEL_ID=...`
6. In `admin.html`, open a cleaner's edit form and set their Slack user ID
   (an Admin does this per cleaner — no self-service linking). Only a
   linked cleaner's messages get a reply; everyone else gets a "Slack
   account isn't linked — ask an Admin" thread reply.

Every request is verified against `SLACK_SIGNING_SECRET` (HMAC over the
raw body, rejecting anything older than 5 minutes) before anything runs.
Full design and threat notes: `docs/superpowers/specs/2026-10-12-slack-integration-design.md`.
