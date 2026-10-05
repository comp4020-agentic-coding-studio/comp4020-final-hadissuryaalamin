# Cleaner Performance & Property Preference System — Design

## Brief context

Final project (COMP4020/COMP8020), built across crits 8 ("It's alive!"), 9
("All at once"), 10 ("Fly by instruments"), due as A3. Fixed requirements:
multi-user, real-time, persists. This document covers the whole app (the
user confirmed this feature set is the entire final project, not one module
of a larger system).

## Domain

A short-stay accommodation business. Two roles for now: **Admin** and
**Cleaner**. Cleaners are ranked by review performance into three tiers,
which gate how many "preferred properties" (a property they're the regular
cleaner for) they may hold.

## Roles & auth

- Username + password login for both roles. Bcrypt-hashed passwords, signed
  session cookie.
- Admin account is seeded at first boot.
- Admin creates cleaner accounts (sets username/password). No public
  self-registration — matches the brief's "sub-role changed only by admin"
  spirit, generalised: admin controls account creation too.

## Data model (SQLite, file on the `/data` Fly volume)

- `users`: id, username (unique), password_hash, role (`admin` | `cleaner`)
- `cleaners`: user_id (FK), rank (`legend` | `awesome` | `normal`, default
  `normal`)
- `reviews`: id, cleaner_id (FK), stars (1-5), period (`YYYY-MM`),
  created_at
- `properties`: id, name, address
- `picks`: cleaner_id (FK), property_id (FK, **unique** — a property has at
  most one owner), slot (1-5, unique per cleaner_id)

## Review cycle

- Reviews are entered by Admin in a **monthly batch**: admin gathers
  ratings somewhere external, then submits one batch covering some/all
  cleaners for the current month.
- **Reviews reset every month**: only the latest `period` present counts
  toward a cleaner's score. Older periods are kept in the table (for
  history / process evidence) but excluded from the live calculation —
  the active period is simply `max(period)` across all rows.
- Submitting a batch triggers one ranking recompute (see below), not one
  recompute per star.

## Scoring

- A cleaner needs **≥ 5 reviews in the active period** to be scored at
  all. Fewer than 5 → forced `normal`, regardless of star values.
- If ≥ 5 reviews: **drop the single lowest-star review entirely** from the
  average (one drop, always, no matter how many reviews beyond 5). Average
  the rest, out of 5 (e.g. five 5★ + one 1★, drop the 1★ → avg of the
  remaining five 5★s = 5.0).
- No `/10` scaling — confirmed avg is out of 5.

## Ranking (leaderboard)

Recomputed on: (a) a new monthly review batch submitted, (b) an admin
manual rank override.

1. Score every eligible (≥5 reviews this period) cleaner.
2. Sort eligible cleaners descending by score; tie-break descending by
   total review count this period; further ties broken by cleaner id
   (stable, deterministic).
3. Top **15** → `legend`. Next **10** → `awesome`. Everyone else
   (including every ineligible cleaner) → `normal`.
4. **Admin override**: admin can directly set a cleaner's rank. This is not
   a separate "locked" state — it's just writing the `rank` column. The
   *next* batch submission runs the normal algorithm again and may
   overwrite the override. No extra schema needed.

## Preferred properties ("picks")

- Each cleaner has their own ranked list of slots, numbered **1st–5th** by
  the order they picked them (not a draft relative to other cleaners).
- Caps by rank: `legend` = 5 slots, `awesome` = 3, `normal` = 0.
- A cleaner may claim any currently-unclaimed property into their next
  free slot number, at any time ("open/anytime", not a turn-based draft).
  Race on the same property: **first DB commit wins** (unique constraint
  on `picks.property_id`), the loser gets a 409.
- **Demotion drops only the excess by slot number**, keeping the
  lowest-numbered (earliest-picked) slots: `legend → awesome` drops slots
  4 and 5; `awesome → normal` drops all 3; `legend → normal` (if it ever
  jumps directly) drops all 5.
- **Promotion never auto-fills.** Gaining slots just raises the cap; the
  cleaner must actively pick to use them.
- A cleaner may also voluntarily release (delete) one of their own picks.

## Real-time & persistence

- Persistence: SQLite file on the Fly volume — survives restart and
  redeploy, satisfying "persists".
- Multi-user: distinct Admin/Cleaner accounts, told apart by session.
- Real-time: a WebSocket broadcast on (a) ranking recompute, (b) a pick
  claimed or released — pushed to every logged-in client so a change one
  person makes (a new rank, a newly-unavailable property) appears for
  everyone else without a reload.

**Scope cut for crit 8 ("It's alive!", this week):** the brief explicitly
allows the real-time layer to wait for crit 9. This week ships everything
above **fully functional and persisted**, but changes propagate on
page reload rather than a live push. The WebSocket layer is added in crit 9
without changing the data model or API shapes below — only how clients
learn about a change.

## API surface

- `POST /login`, `POST /logout`
- Admin only:
  - `POST /api/properties`, `PUT /api/properties/:id`,
    `DELETE /api/properties/:id`
  - `POST /api/cleaners` (create a cleaner account)
  - `POST /api/reviews/batch` (array of `{cleaner_id, stars}` for the
    current period → triggers recompute)
  - `POST /api/cleaners/:id/rank` (manual override → triggers recompute)
- Cleaner (and admin, read-only):
  - `GET /api/me` (own rank, score, current picks, slots remaining)
  - `POST /api/picks` (`{property_id}` → claims into next free slot)
  - `DELETE /api/picks/:id` (release own pick)
- Anyone logged in:
  - `GET /api/leaderboard` (ranked cleaner list with rank/score)
  - `GET /api/properties` (list, with owner if claimed)

## Testing (`spec/`)

Kept alongside the two shipped invariants (`/` answers 200, `/readme/`
publishes the README headings):

- Scoring: the redemption rule (drop-one-lowest, ≥5 required), the <5
  "forced normal" rule.
- Leaderboard: sort order, the 15/10 cap split, the review-count tie-break.
- Picks: cap enforcement by rank, slot numbering, demotion drops the
  correct (highest) slot numbers, a claimed property rejects a second
  claim (409).
- Auth: admin-only routes reject a cleaner session (403); a cleaner can
  only act on their own picks.

## Stack

Node.js + TypeScript + Fastify + `better-sqlite3` + `ws`, inside the
existing Dockerfile/fly.toml shape (one `shared-cpu-1x`/256MB machine, one
`/data` volume). Chosen over a Deno/Fresh or Python/FastAPI alternative to
stay in the template's existing TS/vitest toolchain (no second test
runtime to bridge) and keep the image small for the memory budget — this
reasoning belongs in the stack ADR in `PROCESS.md`.
