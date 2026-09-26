import { type Db, schema } from '@tally/db';
import { eq } from 'drizzle-orm';
import type { ContestTotals, TotalsStore } from './totals-store.js';

/**
 * Rebuilds Redis from Postgres ("Postgres is truth, Redis is speed"): every contestant's absolute
 * total and per-minute counts, written through the same upward-only store as live batches, which
 * sums each contest's total votes and minutes from them. Run at consumer startup, so a flushed or fresh Redis, or data added by a migration
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
        contestantId: voteBuckets.contestantId,
        minute: voteBuckets.bucketMinute,
        count: voteBuckets.count,
      })
      .from(voteBuckets)
      .innerJoin(contestants, eq(contestants.id, voteBuckets.contestantId)),
  ]);

  const byContest = new Map<string, ContestTotals>();
  const entry = (contestId: string) => {
    let e = byContest.get(contestId);
    if (!e) {
      e = { contestId, totals: new Map(), minutes: new Map() };
      byContest.set(contestId, e);
    }
    return e;
  };
  for (const r of totalRows) entry(r.contestId).totals.set(r.contestantId, r.total);
  for (const r of minuteRows) {
    const minutes = entry(r.contestId).minutes;
    const counts = minutes.get(r.minute.getTime()) ?? new Map<string, number>();
    counts.set(r.contestantId, r.count);
    minutes.set(r.minute.getTime(), counts);
  }

  const updates = [...byContest.values()];
  await totals.apply(updates);
  return { contests: updates.length, minutes: minuteRows.length };
}
