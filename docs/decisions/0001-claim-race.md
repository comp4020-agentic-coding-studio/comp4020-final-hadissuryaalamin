# 0001: Two cleaners claiming the same property at once

**Status:** accepted (crit 9)

## The situation

The app is used by a handful of cleaners at the same time, and the thing
they compete for is a property. A property can belong to only one cleaner.
Two cleaners can click "Claim" on the same free property within the same
second, each looking at a list that still shows it as free.

`README.md` says what good means here: "a claimed property staying claimed
under two cleaners clicking at once", and a cleaner being able to "tell what's
theirs, what's free, and what they lost out on by a few seconds". So this is
the multi-user decision that matters most for this app.

There are now three ways to claim: the Claim button on `cleaner.html`, the
in-app assistant, and the Slack channel. All three call the same
`claimProperty` function in `src/api/cleaner.ts`, so one decision covers them
all.

## Options considered

1. **Check, then insert.** Look up whether the property is free, and insert
   the pick if it is. Simple to read, but two requests can both pass the
   check before either inserts, so both cleaners get the property. Rejected:
   it is exactly the bug the README names.
2. **Hold or reserve.** When a cleaner opens a property, lock it for them
   for a short time, and show everyone else "someone is looking at this".
   Fairer to a slow clicker, but it needs presence tracking, lock expiry and
   a new UI state, and a cleaner who opens a property and walks away blocks
   everyone else. Rejected as more machinery than five people need.
3. **First write wins, enforced by the database.** `picks.property_id` has a
   `UNIQUE` constraint. The claim is a single insert inside a transaction;
   the second insert fails the constraint, and that cleaner gets a `409
   Property already claimed`. No pre-check is trusted. **Chosen.**

## The decision

Option 3. The database decides who won, not the application code. SQLite
serialises writes, so one insert always lands first, and the constraint makes
the second one fail instead of creating a duplicate.

Only the winner's request triggers a real-time broadcast (`pick:claimed`), and
only after the insert has committed. The loser's request returns before the
broadcast line, so other open sessions never see a claim that did not happen.
Every open session then re-fetches the property list, and the property drops
out of everyone's "free" list within about a second.

The loser sees the server's message, "Property already claimed", in the
status line under the claim form, not a silent failure. Over the assistant or
Slack, the same refusal comes back as the assistant's reply.

## What this costs

- **No fairness for the slower cleaner.** Whoever's request reaches the
  server first wins, even by a few milliseconds. There is no queue and no
  "you were looking at it first". For a small team that already knows each
  other, the README accepts this: the requirement is that the loser can tell
  they lost, not that they never lose.
- **A cleaner can click on a property that has just gone.** In the second
  before the broadcast arrives, their list is stale. They find out by getting
  the 409, not before.
- **Depends on one database.** The guarantee holds because there is one
  SQLite file on one Fly machine. Running two machines with separate
  databases would break it. `fly.toml` keeps the app at one machine, and that
  setting is now load-bearing.
- **Missed broadcasts while disconnected.** `public/realtime.js` reconnects
  with backoff but does not re-fetch on reconnect. A tab that lost its
  connection shows old data until the next change or a reload. The claim
  itself is still safe, because the database enforces it; only the display
  is behind.

## How it is checked

- `src/api/cleaner.test.ts`: a second claim on an owned property fails with
  `already-claimed`.
- `spec/http.test.ts`: a second cleaner claiming an already-claimed property
  gets a 409.
- `spec/realtime.test.ts`: two concurrent claims on the same property produce
  exactly one 201, one 409, and exactly one `pick:claimed` broadcast, seen by
  a third party's open socket.
