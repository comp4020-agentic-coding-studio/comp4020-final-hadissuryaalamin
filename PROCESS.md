# Process overview

This is the crit 9 version of this file. Everything up to "Where this
stood at crit 8" is unchanged from crit 8; the crit 9 work is in the last
section. Read it as "what happened up to this point," not a running log.

## From brief to design

The final project brief fixes very little on purpose: the app has to be
multi-user, real-time, and persistent, and it has to be something I actually
chose, not a generic CRUD demo. The domain — a short-stay cleaning business
that ranks its cleaners by review score and lets them claim "preferred
properties" — came out of a brainstorming conversation with the agent before
any code existed, working through what a two-role, real internal tool for a
small business would actually need: how reviews get entered, what happens
when a cleaner doesn't have enough reviews yet, what a promotion or demotion
actually does to an existing pick list, what happens when two cleaners try
to claim the same property at the same moment. That conversation is written
up as a single design document,
[`docs/superpowers/specs/2026-10-05-cleaner-performance-system-design.md`](docs/superpowers/specs/2026-10-05-cleaner-performance-system-design.md),
committed in
[`1154a4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/1154a4ad71d10c1fc9a1e0306f8fb96b1fee199b)
right after the scaffold landed in
[`79f0f4d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/79f0f4d49f28a6e9586fc055b733a85bd076ab94).
That document is the actual contract: the data model, the scoring rule (drop
the single lowest review, require five reviews before a cleaner is scored at
all), the 15/10 leaderboard cut, the slot caps and which slots a demotion
takes away first, and the exact API surface. Nothing below the design-doc
level was decided by the agent alone; every rule in it was a question put to
me as the client, not an assumption.

## Turning the design into tasks

Once the design held still, it got split into an epic: one directory per
deliverable, with one task file per unit of work that can be built and
reviewed on its own — auth and session handling, the scoring and ranking
engine, the picks/claims API with its race condition, the frontend screens
for each role, and this documentation task. Task files carry their own
`depends_on` and `conflicts_with` fields so that work on different files can
run in parallel while anything touching the same file (the server entry
point, say) is forced into sequence, and each build task gets handed to its
own sub-agent working in a shared git worktree, one branch, reporting back
through its own `status` field and a short update note rather than a shared
chat transcript.

That task breakdown lives under `.claude/epics/cleaner-performance/`, but
`.claude/` is gitignored — machine-local working state, not something that
ships. So rather than link to it, the honest account is this paragraph: the
work split into nine tasks before any of them started, each with its own
file scope and a written definition of "done," and this file plus the
commit history are what's actually legible from outside.

## Stack decision

**Context.** The app needs one small, always-on-ish HTTP server, a
WebSocket channel for the real-time layer coming in crit 9, and persistence
that survives a restart on a single 256MB Fly machine with one volume. The
course template is already TypeScript end to end, with vitest wired up for
both `spec/` and local tests.

**Decision.** Node.js + TypeScript + Fastify + `better-sqlite3` + `ws`.

**Alternatives considered.**

- *Deno + Fresh.* Deno's permissions model and built-in TypeScript are
  appealing, and Fresh's island architecture is a reasonable fit for a
  small admin-style UI. It was set aside because it would mean running two
  TypeScript toolchains side by side — the course's existing vitest/tsc
  setup for `spec/`, and Deno's own test runner and import story for
  everything else — for a project with exactly one developer and a
  three-week budget. That's a cost with no matching benefit here; Deno's
  sandboxing matters most when running untrusted code, which this app
  never does.
- *Python + FastAPI.* FastAPI's automatic validation and its own async
  story are genuinely nice, and `sqlite3` is in the standard library. It
  was set aside for two reasons: the `spec/` harness that checks the two
  course-level invariants is TypeScript/vitest, so a Python app means
  bridging two languages at the one seam that's graded; and a Python image
  with an ASGI server plus its dependency tree is harder to keep small
  than a single-binary-feeling Node + better-sqlite3 image on a 256MB
  machine.

**Why this one wins.** `better-sqlite3` is synchronous, which matches this
app's actual concurrency shape — one tiny Fly machine, requests arriving one
at a time in practice — and makes the "first DB commit wins" race on a pick
claim a plain `UNIQUE` constraint instead of hand-rolled locking. Fastify
is a thin, well-typed layer over Node's HTTP server, not a framework with
opinions to fight. `ws` is the smallest thing that does a WebSocket
broadcast, which is all crit 9 needs. None of this needs a second runtime,
a second test story, or a bigger image than the volume budget allows.

**Consequences.** One language, one test runner. `better-sqlite3`'s
synchronous calls would bottleneck under real concurrent load, but a
handful of cleaners checking a leaderboard never produces that load.

## Where this stood at crit 8

All nine build tasks landed, in the dependency order the task files set:
DB schema, then auth and the ranking engine in parallel, then the admin and
cleaner API routes, then the Fastify server bootstrap and a real Dockerfile,
then the frontend, then the HTTP-contract tests. `pnpm check` is green
(typecheck, 74 colocated unit tests, 6 contract tests against a running
instance), and the Docker image was built and smoke-tested locally —
including confirming `/data/app.db` actually lands on the volume mount
path — before any Fly deploy. The build diverged from the plan in a few
small, logged ways: `spec/ranking.test.ts` moved to `src/ranking/` (the
scoring functions are pure and don't need a running server, which `spec/`
requires); CI never set the seed-admin environment variables, so its
check job would have 401'd on every admin-gated test — found and fixed
rather than worked around; and the frontend went through a second,
client-directed pass after the first build — splitting one long admin
page into a Dashboard/Cleaners/Properties/Reviews set, adding a CSV
review-upload path and a monthly summary endpoint, and fixing a type-scale
issue the design-review hook flagged. The real-time layer stays out of
scope for this crit, as the brief allows: changes land on reload this
week, and the WebSocket push is crit 9's job without touching the data
model above. Dummy data (30 cleaners, 255 properties) was seeded through the
real API, partly to exercise the endpoints and partly to check the
15/legend, 10/awesome split lands exactly where the design doc says — it
did, unprompted, stronger evidence than a unit test run in isolation.

## Crit 9: real-time, then more than one way in

**Real-time.** The crit 8 design doc deferred live updates on purpose, and
the data model never had to change to add them. A `realtime-updates` epic
added a small broadcast registry
([`ff23d05`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/ff23d0544dc3a765452506bfc7010e07a0a1c476)),
fired it only after a claim or release has actually committed
([`610d9bd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/610d9bd6adaee90e7a9bb1c6c6202729aaf7b5ed)),
and wired every page to re-fetch when an event arrives
([`b00d3a8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/b00d3a8f603760833af03d8c0ec89b15137b36fb)).
The transport is the WebSocket channel the crit 8 stack decision already
chose, authenticated with the same session cookie as every HTTP route.

**The multi-user decision.** Crit 9 asks for one decision about how the app
behaves when several people use it at once, written down with the options
and the cost. Mine is the claim race: two cleaners claiming the same property
in the same second. It is written up as an architecture decision record in
[`docs/decisions/0001-claim-race.md`](docs/decisions/0001-claim-race.md).
Short version: the database's unique constraint decides the winner, the loser
gets a legible 409, and only the winner's claim is broadcast. The cost is no
fairness for the slower click and a hard dependency on a single machine.

**An assistant, then Slack.** I asked for an LLM assistant inside the app,
and it grew in three passes, each with its own design doc in
`docs/superpowers/specs/`: read-only questions first
([`5980cdb`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/5980cdb15d0d26207b510e97031ca7779aafe0f6)),
then write actions behind a propose-then-confirm step
([`1f30a9f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/1f30a9fe739bed118ca0ea7c099c0cd4e3cc42ae)),
then a Slack channel where cleaners can ask for a property in plain words and
the assistant answers in a thread
([`c154db5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/c154db585bc06839730362e8586ebe140951544b),
merged in
[`2f7ef9a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/2f7ef9a6b51a35d44f8888df40e79c4de9a28867)).
None of these added a new way to claim a property: the button, the assistant
and Slack all call the same `claimProperty` function, so the claim race
decision and its tests cover all three. The assistant's model only ever
decides *whether* to run a stored proposal, never *what* it runs.

**Where I had to correct course.** I could not install a Slack app in the
workspace I had joined, because I was a member and not an admin, so the
integration lives in a workspace I created for the project. The first live
test sent messages and got nothing back. The server logs showed Slack had
verified the webhook URL but never sent a single message event. Checking the
bot's token, channel membership and scopes from inside the running server
ruled out the app's side, and the cause turned out to be a Slack setting:
Socket Mode was on, which routes events away from the webhook entirely.
Turning it off fixed it. I also pasted terminal output that contained the bot
token and signing secret, and rotated both before going further.

**State at crit 9.** `pnpm check` is green: typecheck, 251 unit tests and 19
contract tests against a running instance, including the race invariant
under the broadcast layer and the Slack webhook's signature checks. CI is
green on `main` and the app is deployed.
