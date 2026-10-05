# Crit 8 — It's alive!

Writing this early, before the build tasks have landed, so it's honest about
where things actually are rather than where the plan says they'll be. It
will get another pass once the app is running and before the cutoff.

**Breakthrough.** The real move this week wasn't code, it was refusing to
let the domain stay vague. "Rank cleaners by reviews" sounds simple until
you ask what happens with four reviews, or three fives and a one, or a
promotion that doesn't auto-fill a cleaner's new slots. Pinning down the
drop-one-lowest rule, the five-review floor, and the slot-demotion order
*before* any task got dispatched is what let the work split into
independent pieces at all — a scoring engine, a picks API, an auth layer
that can be built and reviewed in parallel because the contract between
them was already settled in writing.

**What this changes about who I want to be as a developer.** I'd rather
spend an extra hour making the client answer an awkward edge case than
spend a day building the wrong thing cleanly. That's a bias toward asking
before assuming that I want to keep past this course.

**Against crit 8's actual bar:** by the cutoff this repo needs to be live at
a `*.fly.dev` URL with the core loop actually working for a stranger whose
action persists, README v1 published at `/readme/`, and the process visible
through commits plus this file and `PROCESS.md`. As of this writing none of
that is verified — the design and task split are committed
([`79f0f4d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/79f0f4d49f28a6e9586fc055b733a85bd076ab94),
[`1154a4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hadissuryaalamin/commit/1154a4ad71d10c1fc9a1e0306f8fb96b1fee199b)),
but the app isn't deployed yet. That's the honest state right now, and it's
what the next pass of this file has to close out.
