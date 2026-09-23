import { redisKeys } from '@tally/contracts';
import { type Db, schema } from '@tally/db';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

/** Where a count disagrees with the recount from `votes`, the source of truth. */
export type Layer =
  | 'vote_totals'
  | 'vote_buckets'
  | 'redis_totals'
  | 'redis_total_votes'
  | 'redis_minutes'
  | 'redis_last_minute';

export interface Drift {
  layer: Layer;
  /** Contestant code, minute (ISO), or both, `C3 @ 2026-09-23T20:01:00.000Z`. */
  key: string;
  expected: number;
  /** What the layer holds; null when the entry is missing. */
  actual: number | null;
}

export interface ContestReport {
  contestId: string;
  name: string;
  /** Votes in the log for this contest: the recount. */
  votes: number;
  drift: Drift[];
  /** Set when `repair` ran: the drift left after repairing (always empty unless something is badly wrong). */
  afterRepair?: Drift[];
  /** How long counting for this contest was paused. */
  pausedMs: number;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Recounts one contest from `votes` and compares every derived count with it: `vote_totals`,
 * `vote_buckets`, and Redis totals, total votes, per-minute counts and last minute.
 *
 * Counting for the contest pauses while this runs: the contest row is taken FOR UPDATE, the same
 * handshake as closing (F16), so in-flight batches finish first and new ones wait. The recount
 * and the layers it is compared with then describe the same instant, with no vote in flight,
 * and a repair can't be undone by a racing batch. Votes queue in Redpanda meanwhile; none are
 * lost.
 *
 * With `repair`, every layer is rewritten to the recount while the lock is held: Postgres rows
 * replaced, Redis hashes overwritten (not the consumer's upward-only write, so a count that is
 * too high comes down too). Contest status in Redis is web's and left alone.
 */
export async function reconcileContest(
  db: Db,
  redis: Redis,
  contestId: string,
  { repair = false }: { repair?: boolean } = {},
): Promise<ContestReport | undefined> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const started = Date.now();
    const [contest] = await tx
      .select({ id: schema.contests.id, name: schema.contests.name })
      .from(schema.contests)
      .where(eq(schema.contests.id, contestId))
      .for('update');
    if (!contest) return undefined;

    const truth = await recount(tx, contestId);
    const drift = await compare(tx, redis, contestId, truth);
    const report: ContestReport = {
      contestId,
      name: contest.name,
      votes: truth.votes,
      drift,
      pausedMs: 0,
    };

    if (repair && drift.length) {
      await rewrite(tx, redis, contestId, truth);
      report.afterRepair = await compare(tx, redis, contestId, truth);
    }
    report.pausedMs = Date.now() - started;
    return report;
  });
}

interface Truth {
  votes: number;
  /** contestantId → code, for every contestant in the contest. */
  codes: Map<string, string>;
  /** contestantId → votes. */
  totals: Map<string, number>;
  /** `${contestantId}|${minuteMs}` → votes. */
  buckets: Map<string, number>;
  /** minuteMs → the contest's votes that minute. */
  minutes: Map<number, number>;
}

async function recount(tx: Tx, contestId: string): Promise<Truth> {
  const { contestants, votes } = schema;
  const [roster, rows] = await Promise.all([
    tx
      .select({ id: contestants.id, code: contestants.code })
      .from(contestants)
      .where(eq(contestants.contestId, contestId)),
    tx
      .select({
        contestantId: votes.contestantId,
        minute: sql<Date>`date_trunc('minute', ${votes.receivedAt})`.mapWith((v) => new Date(v)),
        count: sql<number>`count(*)::int`,
      })
      .from(votes)
      .where(eq(votes.contestId, contestId))
      .groupBy(votes.contestantId, sql`2`),
  ]);
  const truth: Truth = {
    votes: 0,
    codes: new Map(roster.map((r) => [r.id, r.code])),
    totals: new Map(),
    buckets: new Map(),
    minutes: new Map(),
  };
  for (const r of rows) {
    if (!r.contestantId) continue;
    const minute = r.minute.getTime();
    truth.votes += r.count;
    truth.totals.set(r.contestantId, (truth.totals.get(r.contestantId) ?? 0) + r.count);
    truth.buckets.set(`${r.contestantId}|${minute}`, r.count);
    truth.minutes.set(minute, (truth.minutes.get(minute) ?? 0) + r.count);
  }
  return truth;
}

async function compare(tx: Tx, redis: Redis, contestId: string, truth: Truth): Promise<Drift[]> {
  const ids = [...truth.codes.keys()];
  const code = (id: string) => truth.codes.get(id) ?? id;
  const [pgTotals, pgBuckets, redisTotals, redisMinutes, [redisTotalVotes, redisLastMinute]] =
    await Promise.all([
      ids.length
        ? tx.select().from(schema.voteTotals).where(inArray(schema.voteTotals.contestantId, ids))
        : [],
      ids.length
        ? tx.select().from(schema.voteBuckets).where(inArray(schema.voteBuckets.contestantId, ids))
        : [],
      redis.hgetall(redisKeys.totals(contestId)),
      redis.hgetall(redisKeys.minutes(contestId)),
      redis.hmget(redisKeys.meta(contestId), 'totalVotes', 'lastMinute'),
    ]);

  const drift: Drift[] = [];
  /** Compares expected entries with actual ones; an entry only one side has is drift too (0 = absent is fine). */
  const diff = <K>(
    layer: Layer,
    expected: Map<K, number>,
    actual: Map<K, number>,
    label: (k: K) => string,
  ) => {
    for (const k of new Set([...expected.keys(), ...actual.keys()])) {
      const want = expected.get(k) ?? 0;
      const have = actual.get(k);
      if ((have ?? 0) !== want)
        drift.push({ layer, key: label(k), expected: want, actual: have ?? null });
    }
  };

  diff('vote_totals', truth.totals, new Map(pgTotals.map((t) => [t.contestantId, t.total])), code);
  const bucketLabel = (k: string) => {
    const [id = '', minute = '0'] = k.split('|');
    return `${code(id)} @ ${iso(Number(minute))}`;
  };
  diff(
    'vote_buckets',
    truth.buckets,
    new Map(pgBuckets.map((b) => [`${b.contestantId}|${b.bucketMinute.getTime()}`, b.count])),
    bucketLabel,
  );
  diff(
    'redis_totals',
    truth.totals,
    new Map(Object.entries(redisTotals).map(([k, v]) => [k, Number(v)])),
    code,
  );
  diff(
    'redis_minutes',
    truth.minutes,
    new Map(Object.entries(redisMinutes).map(([k, v]) => [Number(k), Number(v)])),
    iso,
  );

  const totalVotes = redisTotalVotes == null ? null : Number(redisTotalVotes);
  if ((totalVotes ?? 0) !== truth.votes) {
    drift.push({
      layer: 'redis_total_votes',
      key: 'totalVotes',
      expected: truth.votes,
      actual: totalVotes,
    });
  }
  const lastMinute = truth.minutes.size ? Math.max(...truth.minutes.keys()) : null;
  const redisLast = redisLastMinute == null ? null : Number(redisLastMinute);
  if (lastMinute !== null && redisLast !== lastMinute) {
    drift.push({
      layer: 'redis_last_minute',
      key: 'lastMinute',
      expected: lastMinute,
      actual: redisLast,
    });
  }
  return drift;
}

/** Sets every layer to the recount. Runs inside the lock, so no batch writes in between. */
async function rewrite(tx: Tx, redis: Redis, contestId: string, truth: Truth) {
  const ids = [...truth.codes.keys()];
  if (ids.length) {
    await tx.delete(schema.voteTotals).where(inArray(schema.voteTotals.contestantId, ids));
    await tx.delete(schema.voteBuckets).where(inArray(schema.voteBuckets.contestantId, ids));
  }
  if (truth.totals.size) {
    await tx
      .insert(schema.voteTotals)
      .values([...truth.totals].map(([contestantId, total]) => ({ contestantId, total })));
  }
  const buckets = [...truth.buckets].map(([k, count]) => {
    const [contestantId = '', minute = '0'] = k.split('|');
    return { contestantId, bucketMinute: new Date(Number(minute)), count };
  });
  for (let i = 0; i < buckets.length; i += 5000) {
    await tx.insert(schema.voteBuckets).values(buckets.slice(i, i + 5000));
  }

  const multi = redis
    .multi()
    .del(redisKeys.totals(contestId), redisKeys.minutes(contestId))
    .hset(redisKeys.meta(contestId), 'totalVotes', truth.votes, 'lastUpdated', Date.now());
  if (truth.totals.size) multi.hset(redisKeys.totals(contestId), Object.fromEntries(truth.totals));
  if (truth.minutes.size) {
    multi.hset(redisKeys.minutes(contestId), Object.fromEntries(truth.minutes));
    multi.hset(redisKeys.meta(contestId), 'lastMinute', Math.max(...truth.minutes.keys()));
  }
  const results = await multi.exec();
  const failed = results?.find(([err]) => err);
  if (failed?.[0]) throw failed[0];
}
