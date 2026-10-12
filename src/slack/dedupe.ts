// Seen-event store for Slack webhook retries.
//
// Slack re-delivers any event not answered with a 2xx within 3 seconds, and
// the assistant call takes longer than that, so the same event_id can arrive
// more than once. The events route calls seenEvent() before doing any work and
// skips the event when it returns true.
//
// Pure in-memory state: a Map of event id to expiry time, expired entries
// pruned on every call. No HTTP, no DB.

const SEEN_TTL_MS = 10 * 60 * 1000;

const seen = new Map<string, number>();

// Returns false the first time an id is seen (and records it), true on any
// repeat within the TTL.
export function seenEvent(eventId: string): boolean {
  const now = Date.now();

  for (const [id, expiresAt] of seen) {
    if (now >= expiresAt) seen.delete(id);
  }

  if (seen.has(eventId)) return true;

  seen.set(eventId, now + SEEN_TTL_MS);
  return false;
}

export function resetSeenEvents(): void {
  seen.clear();
}
