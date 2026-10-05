# Your harness

Rules derived from `README.md`'s "what good means here" argument — a small,
two-role internal tool, not a generic SaaS admin panel. Follow these when
building or changing anything in this repo.

## Never

- No ambient or decorative background animation, no polish for its own sake.
  This app is judged on the ranking math and the pick-claim race being
  correct, not on how it looks.
- No sign-up flow, no public-facing marketing copy, no account types beyond
  Admin and Cleaner. There is no stranger to onboard — every account is
  created by an Admin.
- No framework or bundler in `public/` — plain HTML/CSS/vanilla JS only.
  Matches the "small web" framing in `README.md`; don't reach for a build
  step to solve a problem five form fields already solve.
- Never log, display, or send a cleaner's password anywhere but the hash
  comparison in `src/auth/`. Never weaken a session guard
  (`requireAuth`/`requireRole`) to make a feature easier to wire up.
- Don't add a feature (accounts, profiles, history, scores) the brief and
  `README.md` don't call for, even if it would be easy. Check `README.md`'s
  "what good means here" section before adding scope.

## Always

- Every admin-only route rejects a non-admin session (403) and no session
  (401) — a cleaner may only ever act on their own picks. These are the
  auth-boundary invariants `spec/` and `src/api/*.test.ts` check; don't
  relax them to unblock a feature.
- Every error a person can trigger (a 409 on a claimed property, a rejected
  admin action, a validation failure) gets a legible on-screen message, not
  a silent failure or a raw stack trace.
- If the stack (Node + Fastify + better-sqlite3 + ws, see `PROCESS.md`) ever
  changes, write a new decision record saying why before making the change —
  don't just swap it quietly.
- Keep `spec/*.test.ts` and the two shipped invariants green before calling
  anything done. A red check is a stop, not a note for later.

What the repo ships beyond this is explained where it lives — `fly.toml`,
the `Dockerfile`, the CI workflow and `spec/README.md` each say what they
fix — and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
