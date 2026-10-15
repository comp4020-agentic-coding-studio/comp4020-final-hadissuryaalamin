// "Who did what" log lines for every change a person makes, whichever way
// they made it (web page, in-app assistant, Slack). One JSON line per event
// on stdout, so `flyctl logs` shows it next to Fastify's request log and it
// outlives any one machine. Never pass a password or a session token in.

import type Database from "better-sqlite3";

export type Via = "web" | "assistant" | "slack";
export type Outcome = "ok" | "refused";

export interface AuditInput {
  actor: string;
  role: string;
  via: Via;
  action: string;
  outcome: Outcome;
  detail: string;
}

export interface AuditEvent extends AuditInput {
  audit: true;
  time: string;
  msg: string;
}

function writeLine(event: AuditEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

export function audit(input: AuditInput, sink: (event: AuditEvent) => void = writeLine): void {
  const msg = `${input.actor} (${input.role}) ${input.action} ${input.outcome}: ${input.detail} [${input.via}]`;
  sink({ audit: true, time: new Date().toISOString(), ...input, msg });
}

export function actorLabel(db: Database.Database, userId: number): { actor: string; role: string } {
  const row = db.prepare("SELECT username, role FROM users WHERE id = ?").get(userId) as
    | { username: string; role: string }
    | undefined;
  return row ? { actor: row.username, role: row.role } : { actor: `user#${userId}`, role: "unknown" };
}
