import { describe, expect, it } from "vitest";
import { createConnection } from "./db/connection.ts";
import { actorLabel, audit, type AuditEvent } from "./audit.ts";

function capture(): { events: AuditEvent[]; sink: (event: AuditEvent) => void } {
  const events: AuditEvent[] = [];
  return { events, sink: (event) => events.push(event) };
}

describe("actorLabel", () => {
  it("names the user and their role", () => {
    const db = createConnection(":memory:");
    const id = Number(
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('alice', 'h', 'cleaner')").run()
        .lastInsertRowid,
    );
    expect(actorLabel(db, id)).toEqual({ actor: "alice", role: "cleaner" });
  });

  it("falls back to the id when the user row is gone", () => {
    const db = createConnection(":memory:");
    expect(actorLabel(db, 99)).toEqual({ actor: "user#99", role: "unknown" });
  });
});

describe("audit", () => {
  it("writes one JSON-safe event with actor, role, action, outcome and detail", () => {
    const { events, sink } = capture();
    audit(
      { actor: "alice", role: "cleaner", via: "web", action: "claim", outcome: "ok", detail: "Lakeside Unit 4" },
      sink,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audit: true,
      actor: "alice",
      role: "cleaner",
      via: "web",
      action: "claim",
      outcome: "ok",
      detail: "Lakeside Unit 4",
    });
    expect(events[0].msg).toBe("alice (cleaner) claim ok: Lakeside Unit 4 [web]");
  });

  it("never carries a password field even if a caller passes one in detail-like extras", () => {
    const { events, sink } = capture();
    audit({ actor: "admin", role: "admin", via: "web", action: "create-cleaner", outcome: "ok", detail: "bob" }, sink);
    expect(JSON.stringify(events[0])).not.toMatch(/password/i);
  });
});
