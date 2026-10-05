# Process overview

This is the crit 8 version of this file. It gets rewritten, not appended to,
at crits 9 and 10, so read it as "what happened up to this point," not a
running log.

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

## Where this actually stands

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
