import { type Db, schema } from '@tally/db';
import { and, eq, sql } from 'drizzle-orm';
import type { RecapData } from './data.ts';

const MAX_STEPS = 150;
/** Aim for about this many buckets across the contest's whole span, before quiet ones are dropped. */
const TARGET_STEPS = 120;
const DEFAULT_FROM = '#4B5563';
const DEFAULT_TO = '#1F2937';

/**
 * Reads a contest's final standings (`vote_totals`) and its history (the vote log, bucketed) from
 * Postgres, as the video's props. The history keeps only buckets that had votes, then evenly
 * samples at most MAX_STEPS of them, always keeping the last, so the race ends exactly on the
 * final totals.
 */
export async function exportRecap(db: Db, contestId: string): Promise<RecapData> {
  const { contests, contestants, voteTotals, votes } = schema;
  const [contest] = await db.select().from(contests).where(eq(contests.id, contestId));
  if (!contest) throw new Error(`no contest ${contestId}`);

  const people = await db
    .select({
      id: contestants.id,
      code: contestants.code,
      name: contestants.name,
      imageUrl: contestants.imageUrl,
      accentFrom: contestants.accentFrom,
      accentTo: contestants.accentTo,
      countryCode: contestants.countryCode,
      total: sql<number>`coalesce(${voteTotals.total}, 0)::int`,
    })
    .from(contestants)
    .leftJoin(voteTotals, eq(voteTotals.contestantId, contestants.id))
    .where(and(eq(contestants.contestId, contestId), eq(contestants.active, true)));
  const natural = new Intl.Collator('en', { numeric: true }).compare;
  const ranked = people
    .map((p) => ({
      ...p,
      accentFrom: p.accentFrom ?? DEFAULT_FROM,
      accentTo: p.accentTo ?? DEFAULT_TO,
    }))
    .sort((a, b) => b.total - a.total || natural(a.code, b.code));
  const ids = new Set(ranked.map((p) => p.id));

  // History from the vote log itself, in buckets sized to the contest: fine enough that a short
  // contest still has ~100 steps to race through, coarse enough that a long one stays ~150.
  const [span] = await db
    .select({
      from: sql<Date | null>`min(${votes.receivedAt})`,
      to: sql<Date | null>`max(${votes.receivedAt})`,
    })
    .from(votes)
    .where(eq(votes.contestId, contestId));
  const spanSeconds =
    span?.from && span.to
      ? (new Date(span.to).getTime() - new Date(span.from).getTime()) / 1000
      : 0;
  const bucketSeconds =
    [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find(
      (b) => spanSeconds / b <= TARGET_STEPS,
    ) ?? 3600;
  const buckets = await db
    .select({
      contestantId: votes.contestantId,
      bucket:
        sql<number>`extract(epoch from date_bin(${`${bucketSeconds} seconds`}::interval, ${votes.receivedAt}, timestamptz '2000-01-01'))::bigint * 1000`.mapWith(
          Number,
        ),
      count: sql<number>`count(*)::int`,
    })
    .from(votes)
    .where(eq(votes.contestId, contestId))
    .groupBy(votes.contestantId, sql`2`)
    .orderBy(sql`2`);

  const running: Record<string, number> = Object.fromEntries(ranked.map((p) => [p.id, 0]));
  const byBucket = new Map<number, typeof buckets>();
  for (const b of buckets) byBucket.set(b.bucket, [...(byBucket.get(b.bucket) ?? []), b]);
  // Only buckets that had votes: hours of quiet between runs don't become a stalled race.
  const all = [...byBucket.keys()]
    .sort((a, b) => a - b)
    .map((minute) => {
      for (const b of byBucket.get(minute) ?? []) {
        if (b.contestantId && ids.has(b.contestantId))
          running[b.contestantId] = (running[b.contestantId] ?? 0) + b.count;
      }
      return { minute, totals: { ...running } };
    });
  const stride = Math.max(1, Math.ceil(all.length / MAX_STEPS));
  const steps = all.filter((_, i) => i % stride === 0 || i === all.length - 1);
  // The race starts from nothing, so the first frame isn't already mid-contest.
  if (steps.length)
    steps.unshift({
      minute: steps[0]?.minute ?? 0,
      totals: Object.fromEntries(ranked.map((p) => [p.id, 0])),
    });

  return {
    contest: {
      id: contest.id,
      name: contest.name,
      status: contest.status,
      closesAt: contest.closesAt?.toISOString() ?? null,
    },
    totalVotes: ranked.reduce((s, p) => s + p.total, 0),
    contestants: ranked,
    steps,
  };
}
