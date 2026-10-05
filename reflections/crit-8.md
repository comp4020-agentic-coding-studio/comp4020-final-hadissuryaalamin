# Crit 8 — It's alive!

**Breakthrough.** The real move this week wasn't code, it was refusing to
let the domain stay vague. "Rank cleaners by reviews" sounds simple until
you ask what happens with four reviews, or three fives and a one, or a
promotion that doesn't auto-fill a cleaner's new slots. Pinning down the
drop-one-lowest rule, the five-review floor, and the slot-demotion order
*before* any task got dispatched is what let the work split into
independent pieces at all — a scoring engine, a picks API, an auth layer
that could be built and reviewed in parallel because the contract between
them was already settled in writing. The 30-cleaner dummy data later landed
on exactly 15 legend / 10 awesome / 5 normal, unprompted — the first real
proof the written rule and the shipped code agree.

**What this changes about who I want to be as a developer.** I'd rather
spend an extra hour making the client answer an awkward edge case than
spend a day building the wrong thing cleanly. That's a bias toward asking
before assuming that I want to keep past this course. It showed up again
after the first build landed: the dashboard worked, but a long single page
wasn't actually legible, and saying so got it split into a proper
Dashboard/Cleaners/Properties/Reviews set rather than living with a
"technically done" page.

**Against crit 8's actual bar:** live at a `*.fly.dev` URL, the core loop
working for a stranger whose action persists, README v1 at `/readme/`, and
the process visible through commits, this file, and `PROCESS.md`. All nine
build tasks landed, `pnpm check` is green end to end, and the Docker image
was built and manually walked through — admin login, create a cleaner,
submit a review batch, watch the leaderboard split, claim a property as
that cleaner, log out and back in and find it still there — before trusting
the deploy. One real gap, caught rather than missed: CI never seeded an
admin account, so its own checks would have 401'd silently; fixed in the
workflow, not worked around in the test. The live `*.fly.dev` URL itself
got the same walkthrough after deploying — login, create a cleaner,
promote them, claim a property, log out, log back in, pick still there —
then that smoke-test data was removed so the shipped app starts clean.
