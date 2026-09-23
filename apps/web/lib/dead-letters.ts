import {
  DEAD_LETTER_REASONS,
  type DeadLetterCounts,
  type DeadLetterPage,
  type DeadLetterQuery,
  type DeadLetterReason,
} from '@tally/contracts';
import { type Db, schema } from '@tally/db';
import { and, asc, desc, eq, gt, lt, max, type SQL, sql } from 'drizzle-orm';

// Dead-letter browser queries. Take the db as an argument (no `server-only`) so the keyset
// pagination can be tested against a real Postgres.

const d = schema.deadLetters;

const filters = (q: { contestId?: string | undefined; reason?: DeadLetterReason | undefined }) => {
  const where: SQL[] = [];
  if (q.contestId) where.push(eq(d.contestId, q.contestId));
  if (q.reason) where.push(eq(d.reason, q.reason));
  return where;
};

/**
 * One page, newest first. Keyset on id, never OFFSET: a page stays the same set of rows while
 * new dead letters arrive (they get higher ids), and page 10,000 costs what page 1 does.
 * The `older` / `newer` cursors are set only when rows exist on that side.
 */
export async function queryDeadLetters(db: Db, q: DeadLetterQuery): Promise<DeadLetterPage> {
  const where = filters(q);
  const rows =
    q.after !== undefined
      ? (
          await db
            .select()
            .from(d)
            .where(and(...where, gt(d.id, q.after)))
            .orderBy(asc(d.id))
            .limit(q.limit)
        ).reverse()
      : await db
          .select()
          .from(d)
          .where(and(...where, q.before !== undefined ? lt(d.id, q.before) : undefined))
          .orderBy(desc(d.id))
          .limit(q.limit);

  const first = rows[0];
  const last = rows.at(-1);
  const exists = async (condition: SQL) =>
    (
      await db
        .select({ id: d.id })
        .from(d)
        .where(and(...where, condition))
        .limit(1)
    ).length > 0;

  return {
    items: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      contestId: r.contestId,
      idempotencyKey: r.idempotencyKey,
      receivedAt: r.receivedAt.toISOString(),
      payload: r.payload,
    })),
    older: last && (await exists(lt(d.id, last.id))) ? last.id : null,
    newer: first && (await exists(gt(d.id, first.id))) ? first.id : null,
  };
}

/** Counts per reason for a contest (or all), optionally only rows newer than `since`. */
export async function countDeadLetters(
  db: Db,
  q: { contestId?: string | undefined; since?: number | undefined },
): Promise<DeadLetterCounts> {
  const where = filters(q);
  if (q.since !== undefined) where.push(gt(d.id, q.since));
  const rows = await db
    .select({ reason: d.reason, count: sql<number>`count(*)::int`, latest: max(d.id) })
    .from(d)
    .where(and(...where))
    .groupBy(d.reason);

  const byReason = Object.fromEntries(DEAD_LETTER_REASONS.map((r) => [r, 0])) as Record<
    DeadLetterReason,
    number
  >;
  let latestId: number | null = null;
  for (const r of rows) {
    byReason[r.reason] = r.count;
    if (r.latest !== null && (latestId === null || r.latest > latestId)) latestId = r.latest;
  }
  return { total: rows.reduce((s, r) => s + r.count, 0), byReason, latestId };
}
