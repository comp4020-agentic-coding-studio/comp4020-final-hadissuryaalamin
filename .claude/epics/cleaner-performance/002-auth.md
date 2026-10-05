---
status: completed
depends_on: ["001"]
parallel: true
conflicts_with: []
---
# Auth & sessions

File scope: `src/auth/` (new directory) only.

- Username+password login. Hash with `bcrypt` (or `bcryptjs` if native
  bcrypt is awkward in the Docker build — pick whichever installs
  cleanly in the Alpine/slim base image the Dockerfile ends up using,
  and say which in a short comment).
- Signed session cookie (e.g. `@fastify/secure-session` or
  `@fastify/cookie` + a small signed-token helper — your call, keep it
  minimal). Session carries `user_id` and `role`.
- Seed one admin account at first boot if no admin exists yet (read
  credentials from env vars, e.g. `SEED_ADMIN_USERNAME` /
  `SEED_ADMIN_PASSWORD`; never hardcode a password in source).
- Export two Fastify-friendly guards other tasks import: `requireAuth`
  (any logged-in user) and `requireRole('admin')` (403 otherwise).
- Export a plain function to create a cleaner account (hash + insert) —
  tasks 004 will call this from the admin "create cleaner" endpoint; this
  task does NOT itself add an HTTP route, just the reusable function and
  guards. Routing lives in tasks 004/005.

**Done when:** unit tests (colocated, `src/auth/*.test.ts`) cover: correct
password accepted, wrong password rejected, `requireAuth` rejects no
session, `requireRole('admin')` rejects a cleaner session.
