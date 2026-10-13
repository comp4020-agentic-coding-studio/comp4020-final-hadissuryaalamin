# Crit 9 — All at once

**Breakthrough.** The moment that changed how I worked this week was a
mistake. While connecting the app to Slack, I set the bot token and signing
secret on Fly from my terminal, then copied the terminal output into the chat
with the agent to show it had worked. PowerShell prints the command you typed
above its result, so the paste carried both secrets with it. I had never
typed them into the chat on purpose, which is exactly why I didn't notice.
The agent flagged it straight away. I went into the Slack app settings,
revoked the token and regenerated the signing secret, then set the new values
on Fly myself, in my own terminal, without passing them through the chat
again. Only after that did we carry on with the build.

**What this changes about who I want to be as a developer.** A secret is
leaked the moment it is somewhere it shouldn't be, not the moment someone
misuses it. So the fix is to rotate first and ask questions later, even when
it feels like nobody could have seen it. I also want to treat anything I
copy out of a terminal as possibly containing a secret: paste only the lines
that matter, never the command line. Credentials should go from the provider
to where they are stored, and nowhere in between.
