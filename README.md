# Cleaner Performance & Property Preference

## What this is

This is an internal tool for one short-stay accommodation business. It has two
kinds of users: an Admin, who enters monthly review batches and manages the
property list, and a handful of Cleaners, who check their rank and claim the
properties they want to keep cleaning. Nobody outside that business will ever
have an account. There is no sign-up flow, no onboarding tour, no marketing
copy, because there is no stranger to market to.

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

`spec/` checks the parts where "good" has one correct answer: the scoring
rule (drop-one-lowest, the five-review floor), the 15/legend, 10/awesome
leaderboard cut and its tie-break, slot caps and which slots a demotion
drops, and that a race for the same property only ever has one winner.
Auth boundaries — an admin-only route rejecting a cleaner session, a cleaner
only ever acting on their own picks — are checked the same way.

## What a person has to judge

Whether the leaderboard and pick screens are actually readable at a glance,
whether an error (a 409 on a claimed property, a rejected admin action) is
legible to the person who hit it, and whether the whole thing reads as a
tool built for five people rather than five thousand — none of that has a
single correct answer a test can assert. That's left to the crit and the
marker, same as the brief says.
