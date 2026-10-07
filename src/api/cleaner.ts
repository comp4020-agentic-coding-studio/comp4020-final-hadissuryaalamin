// Cleaner-facing & shared read API routes: epic.md "API surface" (cleaner +
// "anyone logged in" sections) and task 005. Routing + transaction wiring
// only — auth comes from task 002 (requireAuth), scoring/ranking math from
// task 003 (ranking/*). No Fastify server instance exists yet (task 006);
// this module exports a plugin function for that task to `app.register(...)`
// (same shape as task 004's src/api/admin.ts: `(app, { db }) => Promise<void>`).

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/index.ts";
import { activePeriod, capForRank, computeScore, type PeriodedReview, type Rank } from "../ranking/index.ts";
import type { CleanerRow, PickRow, PropertyRow } from "../db/types.ts";
import { broadcast } from "../realtime/broadcast.ts";

/** Order used to sort the leaderboard response by tier (legend first). */
const RANK_ORDER: Record<Rank, number> = { legend: 0, awesome: 1, normal: 2 };

/** A cleaner's reviews, filtered to the active period, scored (null if <5). */
function scoreForCleaner(db: Database.Database, cleanerId: number): number | null {
  const reviews = db
    .prepare("SELECT stars, period FROM reviews WHERE cleaner_id = ?")
    .all(cleanerId) as PeriodedReview[];
  const active = activePeriod(reviews);
  return computeScore(active.map((r) => ({ stars: r.stars })));
}

/** Body of `GET /api/me`: a cleaner's own status, or undefined if no cleaner row. */
export function getMyStatus(db: Database.Database, userId: number) {
  const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(userId) as
    | CleanerRow
    | undefined;
  if (!cleaner) {
    return undefined;
  }

  const score = scoreForCleaner(db, userId);
  const picks = db
    .prepare("SELECT * FROM picks WHERE cleaner_id = ? ORDER BY slot")
    .all(userId) as PickRow[];
  const cap = capForRank(cleaner.rank);
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as
    | { username: string }
    | undefined;

  return {
    username: user?.username ?? null,
    rank: cleaner.rank,
    score,
    picks: picks.map((p) => ({ id: p.id, property_id: p.property_id, slot: p.slot })),
    slots_remaining: cap - picks.length,
  };
}

/** Body of `GET /api/leaderboard`: every cleaner, ranked and sorted. */
export function getLeaderboard(db: Database.Database) {
  const rows = db
    .prepare(
      "SELECT c.user_id AS cleaner_id, c.rank, u.username FROM cleaners c JOIN users u ON u.id = c.user_id",
    )
    .all() as { cleaner_id: number; rank: Rank; username: string }[];

  const entries = rows.map((r) => ({
    cleaner_id: r.cleaner_id,
    username: r.username,
    rank: r.rank,
    score: scoreForCleaner(db, r.cleaner_id),
  }));

  entries.sort((a, b) => {
    if (RANK_ORDER[a.rank] !== RANK_ORDER[b.rank]) return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (a.score !== b.score) return (b.score ?? -1) - (a.score ?? -1);
    return a.cleaner_id - b.cleaner_id;
  });

  return entries;
}

/** Body of `GET /api/properties`: every property with its current claimant, if any. */
export function getPropertiesList(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.address, u.username AS owner_username
       FROM properties p
       LEFT JOIN picks pk ON pk.property_id = p.id
       LEFT JOIN users u ON u.id = pk.cleaner_id
       ORDER BY p.id`,
    )
    .all() as { id: number; name: string; address: string; owner_username: string | null }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    owner: r.owner_username ?? null,
  }));
}

export default async function cleanerRoutes(app: FastifyInstance, opts: { db: Database.Database }): Promise<void> {
  const { db } = opts;
  const authed = { preHandler: requireAuth };

  app.get("/api/me", authed, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.session!.user_id;
    const status = getMyStatus(db, userId);
    if (!status) {
      return reply.code(404).send({ error: "Not a cleaner" });
    }
    return reply.send(status);
  });

  app.post(
    "/api/picks",
    authed,
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.session!.role !== "cleaner") {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const userId = request.session!.user_id;
      const propertyId = (request.body as { property_id?: number } | undefined)?.property_id;
      if (typeof propertyId !== "number") {
        return reply.code(400).send({ error: "property_id is required" });
      }

      const cleaner = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(userId) as
        | CleanerRow
        | undefined;
      if (!cleaner) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(propertyId) as
        | PropertyRow
        | undefined;
      if (!property) {
        return reply.code(404).send({ error: "Property not found" });
      }

      const cap = capForRank(cleaner.rank);
      const existingPicks = db
        .prepare("SELECT slot FROM picks WHERE cleaner_id = ?")
        .all(userId) as { slot: number }[];
      if (existingPicks.length >= cap) {
        return reply.code(400).send({ error: "No free slot" });
      }

      const usedSlots = new Set(existingPicks.map((p) => p.slot));
      let nextSlot = 1;
      while (usedSlots.has(nextSlot)) nextSlot++;

      // Rely on the DB's unique constraint on picks.property_id to reject a
      // racing double-claim (409) rather than pre-checking then inserting.
      try {
        const insert = db.transaction((slot: number) => {
          db.prepare("INSERT INTO picks (cleaner_id, property_id, slot) VALUES (?, ?, ?)").run(
            userId,
            propertyId,
            slot,
          );
        });
        insert(nextSlot);
      } catch {
        return reply.code(409).send({ error: "Property already claimed" });
      }

      const row = db
        .prepare("SELECT * FROM picks WHERE cleaner_id = ? AND property_id = ?")
        .get(userId, propertyId) as PickRow;
      broadcast({ type: "pick:claimed", payload: { property_id: propertyId } });
      return reply.code(201).send(row);
    },
  );

  app.delete(
    "/api/picks/:id",
    authed,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.session!.user_id;
      const id = Number((request.params as { id: string }).id);
      const pick = db.prepare("SELECT * FROM picks WHERE id = ?").get(id) as PickRow | undefined;
      if (!pick) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (pick.cleaner_id !== userId) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      db.prepare("DELETE FROM picks WHERE id = ?").run(id);
      broadcast({ type: "pick:released", payload: { property_id: pick.property_id } });
      return reply.code(204).send();
    },
  );

  app.get("/api/leaderboard", authed, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(getLeaderboard(db));
  });

  app.get("/api/properties", authed, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(getPropertiesList(db));
  });
}
