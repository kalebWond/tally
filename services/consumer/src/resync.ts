import { type Db, schema } from '@tally/db';
import { eq, sql } from 'drizzle-orm';
import type { ContestTotals, TotalsStore } from './totals-store.js';

/**
 * Rebuilds Redis from Postgres ("Postgres is truth, Redis is speed"): every contest's absolute
 * totals, total votes and per-minute counts, written through the same upward-only store as live
 * batches. Run at consumer startup, so a flushed or fresh Redis, or data added by a migration
 * (the F17 bucket backfill), is visible before new votes arrive. Safe alongside live batches:
 * both write committed Postgres values, and a value never goes down.
 * Contest status is left to web, its only writer (F16).
 */
export async function resyncRedis(db: Db, totals: TotalsStore) {
  const { contestants, voteTotals, voteBuckets } = schema;
  const [totalRows, minuteRows] = await Promise.all([
    db
      .select({
        contestId: contestants.contestId,
        contestantId: voteTotals.contestantId,
        total: voteTotals.total,
      })
      .from(voteTotals)
      .innerJoin(contestants, eq(contestants.id, voteTotals.contestantId)),
    db
      .select({
        contestId: contestants.contestId,
        minute: voteBuckets.bucketMinute,
        count: sql<number>`sum(${voteBuckets.count})::int`,
      })
      .from(voteBuckets)
      .innerJoin(contestants, eq(contestants.id, voteBuckets.contestantId))
      .groupBy(contestants.contestId, voteBuckets.bucketMinute),
  ]);

  const byContest = new Map<string, ContestTotals>();
  const entry = (contestId: string) => {
    let e = byContest.get(contestId);
    if (!e) {
      e = { contestId, totals: new Map(), totalVotes: 0, minutes: new Map() };
      byContest.set(contestId, e);
    }
    return e;
  };
  for (const r of totalRows) {
    const e = entry(r.contestId);
    e.totals.set(r.contestantId, r.total);
    e.totalVotes += r.total;
  }
  for (const r of minuteRows) entry(r.contestId).minutes.set(r.minute.getTime(), r.count);

  const updates = [...byContest.values()];
  await totals.apply(updates);
  return { contests: updates.length, minutes: minuteRows.length };
}
