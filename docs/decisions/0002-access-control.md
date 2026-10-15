# 0002: Who may see and change what

**Status:** accepted (crit 10)

## The situation

The app has two kinds of person and nobody else. `README.md` is explicit:
an Admin "enters monthly review batches and manages the property list", and
a handful of Cleaners "check their rank and claim the properties they want
to keep cleaning". Every account is created by the Admin; there is no sign-up.

A person is a row in `users` with a username, a bcrypt password hash and a
role (`admin` or `cleaner`). Signing in sets a signed, HTTP-only session
cookie holding the user's id and role. Two people in two browsers have two
different cookies, so the server always knows which of them sent a request.

Crit 10 asks for the decision about what each person may see and change,
checked on the server and written down with why. This is it.

## The rules

| | Admin | Cleaner |
|---|---|---|
| See the leaderboard (every cleaner's rank and score) | yes | yes |
| See every property and who owns it | yes | yes |
| See their own rank, score, picks and free slots | n/a | yes, own only |
| Claim a free property | no | yes, for themselves |
| Release a claim | no | own claims only |
| Add, edit or delete properties | yes | no |
| Create or delete cleaner accounts | yes | no |
| Submit a review batch, override a rank | yes | no |
| Link a cleaner's Slack ID | yes | no |
| See review stats and assistant usage | yes | no |
| Use the assistant | yes, admin tools | yes, cleaner tools |

## Why these rules

- **Everyone sees the leaderboard and who owns what.** README's test for
  "good" is that a cleaner can "immediately tell what's theirs, what's free,
  and what they lost out on by a few seconds". That only works if the
  ranking and the ownership of every property are visible to every cleaner.
  For five people who already know each other, the scores are not secret;
  hiding them would make the ranking feel arbitrary.
- **A cleaner only ever acts on their own picks.** A claim always goes to the
  signed-in cleaner's own account; there is no field to name someone else.
  A release checks the pick belongs to the caller. One cleaner cannot take
  or drop another's property, which is the one thing a cleaner could do to
  hurt a colleague.
- **The Admin manages the data but does not claim.** Properties, accounts,
  reviews and ranks are the business's records, so only the Admin changes
  them. The Admin has no cleaner row and no slots, so claiming would mean
  nothing; the server refuses it rather than inventing a meaning.
- **No finer roles.** There is one Admin and a few Cleaners. A "manager" or
  "read-only" role would be generality the business does not need, which
  the repo's `CLAUDE.md` rules out.

## Where the server checks it

Every check is on the server. The pages hide buttons a person can't use, but
that is convenience; a hand-written request gets the same answer.

- `src/auth/guards.ts`: `requireAuth` returns 401 with no valid session.
  `requireRole("admin")` returns 401 with no session and 403 for a cleaner.
- `src/api/admin.ts`: every route uses `requireRole("admin")`.
- `src/api/cleaner.ts`: reads use `requireAuth`. `POST /api/picks` returns
  403 unless the role is `cleaner`, and always claims for the session's own
  user id. `releaseProperty` returns `forbidden` (403) if the pick isn't the
  caller's.
- `src/assistant/tools.ts`: the assistant only gets the tool set for the
  caller's role, and every write runs the same `claimProperty`,
  `releaseProperty` and admin functions as the pages, under the caller's own
  user id. The model can choose whether to carry out a stored proposal, never
  what it does or for whom.
- `src/api/slack.ts`: a Slack message only acts as the cleaner whose Slack ID
  the Admin linked; an unlinked Slack user gets a "not linked" reply and
  nothing runs. Requests must carry a valid Slack signature.

## Who did what: the audit log

Every change a person makes writes one JSON line to stdout through
`src/audit.ts`, whether it came from a page, the assistant or Slack. Refused
attempts are logged too. Each line has `actor` (username), `role`, `via`
(`web`, `assistant`, `slack`), `action`, `outcome` (`ok` or `refused`) and a
human-readable `msg`, for example:

```
alice (cleaner) claim ok: property 4 "Lakeside Unit 4" into slot 1 [web]
bob (cleaner) claim refused: property 4 "Lakeside Unit 4" (already-claimed) [web]
bob (cleaner) POST /api/properties refused: needs admin [web]
```

Passwords and session tokens are never passed to it. On Fly the lines go to
the platform log, so they outlive any one machine restart:

```sh
mise exec -- flyctl logs -a comp4020-final-hadissuryaalamin | grep '"audit":true'
```

## What this costs

- **Scores are not private.** A cleaner can see a colleague's score. That is
  deliberate (see above), but a business that wanted private scores would
  need a new rule.
- **One Admin can do everything.** There is no second sign-off on deleting a
  cleaner or a property. The audit log is the only record afterwards.
- **The log is not a database table.** It lives in Fly's log retention, not
  in the app. That is enough for "who did what at the crit" and for
  debugging, but it is not a permanent history.

## How it is checked

- `src/auth/guards.test.ts`, `src/api/admin.test.ts`,
  `src/api/cleaner.test.ts`: 401 without a session, 403 for the wrong role,
  `forbidden` when releasing someone else's pick.
- `spec/http.test.ts`: the same boundaries against a running server.
- `src/api/audit-routes.test.ts`: a claim race logs the winner as `ok` and
  the loser as `refused`, by name; a cleaner releasing another's pick is
  logged as refused; creating a cleaner logs the admin's name and never the
  password.
