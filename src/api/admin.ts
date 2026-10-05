// Admin API routes: epic.md "API surface" (admin-only section) and task
// 004. Routing + transaction wiring only — auth comes from task 002
// (requireRole), scoring/ranking math from task 003 (ranking/*). No Fastify
// server instance exists yet (task 006); this module exports a plugin
// function for that task to `app.register(...)`.

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createCleanerAccount, requireRole } from "../auth/index.ts";
import {
  activePeriod,
  capForRank,
  computeLeaderboard,
  slotsToDrop,
  type CleanerForLeaderboard,
  type PeriodedReview,
  type Rank,
} from "../ranking/index.ts";
import type { CleanerRow, PropertyRow } from "../db/types.ts";

/** "YYYY-MM" for right now — the active review-batch period. */
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

interface ReviewBatchItem {
  cleaner_id: number;
  stars: number;
}

function isReviewBatchItem(value: unknown): value is ReviewBatchItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.cleaner_id === "number" && typeof v.stars === "number";
}

/**
 * Recomputes the leaderboard over ALL cleaners' active-period reviews,
 * writes the resulting ranks, and drops any now-excess picks (per
 * slotsToDrop) for cleaners whose cap shrank. Caller runs this inside its
 * own `db.transaction(...)`.
 */
function recomputeAndApply(db: Database.Database): void {
  const cleanerIds = db
    .prepare("SELECT user_id FROM cleaners")
    .all()
    .map((row) => (row as { user_id: number }).user_id);

  const cleanersForLeaderboard: CleanerForLeaderboard[] = cleanerIds.map((cleanerId) => {
    const rows = db
      .prepare("SELECT stars, period FROM reviews WHERE cleaner_id = ?")
      .all(cleanerId) as PeriodedReview[];
    const active = activePeriod(rows);
    return { cleanerId, reviews: active.map((r) => ({ stars: r.stars })) };
  });

  const leaderboard = computeLeaderboard(cleanersForLeaderboard);

  const updateRank = db.prepare("UPDATE cleaners SET rank = ? WHERE user_id = ?");
  for (const entry of leaderboard) {
    updateRank.run(entry.rank, entry.cleanerId);
  }

  for (const entry of leaderboard) {
    applyCapDrops(db, entry.cleanerId, entry.rank);
  }
}

/** Drops any picks beyond the new cap for one cleaner's new rank. */
function applyCapDrops(db: Database.Database, cleanerId: number, rank: Rank): void {
  const cap = capForRank(rank);
  const picks = db
    .prepare("SELECT slot FROM picks WHERE cleaner_id = ?")
    .all(cleanerId) as { slot: number }[];
  const drop = slotsToDrop(picks, cap);
  if (drop.length === 0) return;
  const del = db.prepare("DELETE FROM picks WHERE cleaner_id = ? AND slot = ?");
  for (const slot of drop) {
    del.run(cleanerId, slot);
  }
}

export default async function adminRoutes(app: FastifyInstance, opts: { db: Database.Database }): Promise<void> {
  const { db } = opts;
  const adminOnly = { preHandler: requireRole("admin") };

  app.post<{ Body: { name: string; address: string } }>(
    "/api/properties",
    adminOnly,
    async (request, reply) => {
      const { name, address } = request.body ?? ({} as { name: string; address: string });
      if (typeof name !== "string" || typeof address !== "string") {
        return reply.code(400).send({ error: "name and address are required" });
      }
      const result = db
        .prepare("INSERT INTO properties (name, address) VALUES (?, ?)")
        .run(name, address);
      const row = db
        .prepare("SELECT * FROM properties WHERE id = ?")
        .get(result.lastInsertRowid) as PropertyRow;
      return reply.code(201).send(row);
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; address?: string } }>(
    "/api/properties/:id",
    adminOnly,
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
        | PropertyRow
        | undefined;
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      const name = request.body?.name ?? existing.name;
      const address = request.body?.address ?? existing.address;
      db.prepare("UPDATE properties SET name = ?, address = ? WHERE id = ?").run(name, address, id);
      const row = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as PropertyRow;
      return reply.send(row);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/properties/:id",
    adminOnly,
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
        | PropertyRow
        | undefined;
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      db.prepare("DELETE FROM properties WHERE id = ?").run(id);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    "/api/cleaners",
    adminOnly,
    async (request, reply) => {
      const { username, password } = request.body ?? ({} as { username: string; password: string });
      if (typeof username !== "string" || typeof password !== "string") {
        return reply.code(400).send({ error: "username and password are required" });
      }
      try {
        const result = await createCleanerAccount(db, { username, password });
        const row = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(result.user_id) as CleanerRow;
        return reply.code(201).send({ ...result, rank: row.rank });
      } catch {
        return reply.code(409).send({ error: "Username already taken" });
      }
    },
  );

  app.post<{ Body: unknown }>(
    "/api/reviews/batch",
    adminOnly,
    async (request, reply) => {
      const body = request.body;
      if (!Array.isArray(body) || !body.every(isReviewBatchItem)) {
        return reply.code(400).send({ error: "Body must be an array of {cleaner_id, stars}" });
      }
      const period = currentPeriod();

      const run = db.transaction((items: ReviewBatchItem[]) => {
        const insert = db.prepare(
          "INSERT INTO reviews (cleaner_id, stars, period) VALUES (?, ?, ?)",
        );
        for (const item of items) {
          insert.run(item.cleaner_id, item.stars, period);
        }
        recomputeAndApply(db);
      });
      run(body);

      return reply.code(200).send({ period, count: body.length });
    },
  );

  app.post<{ Params: { id: string }; Body: { rank: string } }>(
    "/api/cleaners/:id/rank",
    adminOnly,
    async (request, reply) => {
      const cleanerId = Number(request.params.id);
      const rank = request.body?.rank;
      if (rank !== "legend" && rank !== "awesome" && rank !== "normal") {
        return reply.code(400).send({ error: "rank must be legend, awesome, or normal" });
      }
      const existing = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(cleanerId) as
        | CleanerRow
        | undefined;
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }

      const run = db.transaction((newRank: Rank) => {
        db.prepare("UPDATE cleaners SET rank = ? WHERE user_id = ?").run(newRank, cleanerId);
        applyCapDrops(db, cleanerId, newRank);
      });
      run(rank as Rank);

      const row = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(cleanerId) as CleanerRow;
      return reply.send(row);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/cleaners/:id",
    adminOnly,
    async (request, reply) => {
      const cleanerId = Number(request.params.id);
      const existing = db.prepare("SELECT * FROM cleaners WHERE user_id = ?").get(cleanerId) as
        | CleanerRow
        | undefined;
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }

      // Children first (no ON DELETE CASCADE on these FKs), then the
      // leaderboard is recomputed over the now-smaller cleaner pool —
      // removing someone can shift the legend/awesome cap boundary.
      const run = db.transaction((id: number) => {
        db.prepare("DELETE FROM picks WHERE cleaner_id = ?").run(id);
        db.prepare("DELETE FROM reviews WHERE cleaner_id = ?").run(id);
        db.prepare("DELETE FROM cleaners WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
        recomputeAndApply(db);
      });
      run(cleanerId);

      return reply.code(204).send();
    },
  );

  app.get("/api/reviews/summary", adminOnly, async (_request: FastifyRequest, reply: FastifyReply) => {
    const periodRow = db.prepare("SELECT MAX(period) AS period FROM reviews").get() as {
      period: string | null;
    };
    const period = periodRow.period;
    if (!period) {
      return reply.send({ period: null, total_reviews: 0, cleaners_reviewed: 0, average_stars: null });
    }

    const stats = db
      .prepare(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT cleaner_id) AS cleaners, AVG(stars) AS avg_stars " +
          "FROM reviews WHERE period = ?",
      )
      .get(period) as { total: number; cleaners: number; avg_stars: number | null };

    // Raw average across every review this period — distinct from each
    // cleaner's own computeScore (which drops their single worst review).
    return reply.send({
      period,
      total_reviews: stats.total,
      cleaners_reviewed: stats.cleaners,
      average_stars: stats.avg_stars === null ? null : Math.round(stats.avg_stars * 100) / 100,
    });
  });
}
