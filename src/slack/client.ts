// Outbound Slack call: post a thread reply with chat.postMessage.
//
// Slack answers HTTP 200 even on failure, with `{ ok: false, error }` in the
// body, so the body is checked, not the status. With SLACK_TEST_STUB=1 no
// network call is made (same idea as ASSISTANT_TEST_STUB). The bot token is
// read from the environment per call and is never logged or put in an error.

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export async function postThreadReply(channel: string, threadTs: string, text: string): Promise<void> {
  if (process.env.SLACK_TEST_STUB === "1") return;

  const response = await fetch(POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });

  const result = (await response.json()) as { ok?: boolean; error?: string };
  if (!result.ok) {
    throw new Error(`slack chat.postMessage failed: ${result.error ?? "unknown_error"}`);
  }
}
