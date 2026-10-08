// Pending-proposal store for the assistant's two-turn confirm flow.
//
// Each POST /api/assistant call starts a brand-new, stateless model
// conversation -- no message history is kept across requests. So when a
// propose_* tool asks the user to confirm an action, the only way the model
// can know on the user's NEXT message that a proposal is still pending is if
// the server re-tells it, every call, via the system prompt. That re-told
// sentence is exactly the `description` stored here: the human-readable
// sentence the propose_* tool already composed, stored once at propose time,
// never regenerated.
//
// Pure in-memory state, one pending proposal per user at a time. No HTTP, no
// DB, no Anthropic dependency.

const PROPOSAL_TTL_MS = 5 * 60 * 1000;

interface StoredProposal {
  type: string;
  data: unknown;
  description: string;
  expiresAt: number;
}

export interface Proposal {
  type: string;
  data: unknown;
  description: string;
}

const proposals = new Map<number, StoredProposal>();

export function setProposal(userId: number, type: string, data: unknown, description: string): void {
  proposals.set(userId, {
    type,
    data,
    description,
    expiresAt: Date.now() + PROPOSAL_TTL_MS,
  });
}

export function getProposal(userId: number): Proposal | undefined {
  const stored = proposals.get(userId);
  if (!stored) return undefined;

  if (Date.now() >= stored.expiresAt) {
    proposals.delete(userId);
    return undefined;
  }

  return { type: stored.type, data: stored.data, description: stored.description };
}

export function clearProposal(userId: number): void {
  proposals.delete(userId);
}
