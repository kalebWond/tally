import { type DeadLetterEvent, redisKeys } from '@tally/contracts';
import { schema } from '@tally/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type InboundMessage, processBatch } from './process.js';
import { reconcileContest } from './reconcile.js';
import { createResolver } from './resolver.js';
import { CONTEST_ID, createTestStores, voteEvent } from './test-support.js';
import { createTotalsStore } from './totals-store.js';

// F18: every derived count (vote_totals, vote_buckets, Redis) is checked against a recount of
// the vote log; corruption is reported precisely and --repair restores it, even mid-traffic.

let stores: Awaited<ReturnType<typeof createTestStores>>;
let offset = 0n;
const asMessages = (events: object[]): InboundMessage[] =>
  events.map((e) => ({
    topic: 'votes.raw',
    partition: 0,
    offset: offset++,
    value: JSON.stringify(e),
  }));
const deps = () => ({
  db: stores.db,
  resolver: createResolver(stores.db),
  totals: createTotalsStore(stores.redis),
  deadLetters: { publish: async (_: DeadLetterEvent[]) => {} },
});
const MINUTE = Date.UTC(2026, 8, 23, 20, 0);
const idOf = async (code: string) =>
  (
    await stores.db
      .select({ id: schema.contestants.id })
      .from(schema.contestants)
      .where(eq(schema.contestants.code, code))
  )[0]?.id ?? '';

beforeAll(async () => {
  stores = await createTestStores();
});
afterAll(async () => stores?.cleanup());
beforeEach(async () => {
  await stores.db.execute(sql`truncate votes, vote_totals, vote_buckets, dead_letters`);
  await stores.redis.flushdb();
  // 60 votes: C1 ×30, C2 ×20, C3 ×10, over two minutes.
  const events = [
    ...Array.from({ length: 30 }, (_, i) =>
      voteEvent('C1', { sent_at: new Date(MINUTE + (i % 2) * 60_000).toISOString() }),
    ),
    ...Array.from({ length: 20 }, () =>
      voteEvent('C2', { sent_at: new Date(MINUTE).toISOString() }),
    ),
    ...Array.from({ length: 10 }, () =>
      voteEvent('C3', { sent_at: new Date(MINUTE + 60_000).toISOString() }),
    ),
  ];
  await processBatch(asMessages(events), deps());
});

describe('reconcileContest', () => {
  it('reports no drift when every layer agrees with the vote log', async () => {
    expect(await reconcileContest(stores.db, stores.redis, CONTEST_ID)).toMatchObject({
      votes: 60,
      drift: [],
    });
  });

  it('detects a corrupted Redis counter, too low or too high, with expected and actual', async () => {
    await stores.redis.hset(redisKeys.totals(CONTEST_ID), await idOf('C1'), 7);
    await stores.redis.hset(redisKeys.totals(CONTEST_ID), await idOf('C2'), 999);
    const report = await reconcileContest(stores.db, stores.redis, CONTEST_ID);
    expect(report?.drift).toEqual(
      expect.arrayContaining([
        { layer: 'redis_totals', key: 'C1', expected: 30, actual: 7 },
        { layer: 'redis_totals', key: 'C2', expected: 20, actual: 999 },
      ]),
    );
    expect(report?.drift).toHaveLength(2);
  });

  it('detects drift in every other layer: vote_totals, vote_buckets, Redis minutes, total and last minute', async () => {
    const c3 = await idOf('C3');
    await stores.db
      .update(schema.voteTotals)
      .set({ total: 11 })
      .where(eq(schema.voteTotals.contestantId, c3));
    await stores.db
      .update(schema.voteBuckets)
      .set({ count: 1 })
      .where(eq(schema.voteBuckets.contestantId, c3));
    await stores.redis.hdel(redisKeys.minutes(CONTEST_ID), String(MINUTE));
    await stores.redis.hset(redisKeys.meta(CONTEST_ID), { totalVotes: 61, lastMinute: MINUTE });
    await stores.redis.hset(
      redisKeys.totals(CONTEST_ID),
      '00000000-0000-4000-8000-000000000999',
      4,
    ); // a stranger

    const drift = (await reconcileContest(stores.db, stores.redis, CONTEST_ID))?.drift ?? [];
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(drift).toEqual(
      expect.arrayContaining([
        { layer: 'vote_totals', key: 'C3', expected: 10, actual: 11 },
        { layer: 'vote_buckets', key: `C3 @ ${iso(MINUTE + 60_000)}`, expected: 10, actual: 1 },
        { layer: 'redis_minutes', key: iso(MINUTE), expected: 35, actual: null },
        { layer: 'redis_total_votes', key: 'totalVotes', expected: 60, actual: 61 },
        {
          layer: 'redis_last_minute',
          key: 'lastMinute',
          expected: MINUTE + 60_000,
          actual: MINUTE,
        },
        {
          layer: 'redis_totals',
          key: '00000000-0000-4000-8000-000000000999',
          expected: 0,
          actual: 4,
        },
      ]),
    );
    expect(drift).toHaveLength(6);
  });

  it('repair restores every layer, lowering too-high values, and leaves contest status alone', async () => {
    await stores.redis.hset(redisKeys.totals(CONTEST_ID), await idOf('C2'), 999);
    await stores.redis.hset(redisKeys.meta(CONTEST_ID), { totalVotes: 5000, status: 'open' });
    await stores.db
      .update(schema.voteTotals)
      .set({ total: 0 })
      .where(eq(schema.voteTotals.contestantId, await idOf('C1')));

    const repaired = await reconcileContest(stores.db, stores.redis, CONTEST_ID, { repair: true });
    expect(repaired?.drift.length).toBeGreaterThan(0);
    expect(repaired?.afterRepair).toEqual([]);
    expect(await reconcileContest(stores.db, stores.redis, CONTEST_ID)).toMatchObject({
      drift: [],
    });
    expect(await stores.redis.hget(redisKeys.totals(CONTEST_ID), await idOf('C2'))).toBe('20');
    expect(await stores.redis.hget(redisKeys.meta(CONTEST_ID), 'status')).toBe('open');
  });

  it('a repair in the middle of live traffic loses nothing and leaves no drift', async () => {
    // Too high: the one corruption live traffic can't heal (its writes only ever raise a value).
    await stores.redis.hset(redisKeys.totals(CONTEST_ID), await idOf('C1'), 999_999);
    let running = true;
    let sent = 60;
    const traffic = (async () => {
      while (running) {
        const batch = Array.from({ length: 25 }, (_, i) => voteEvent(`C${(i % 5) + 1}`));
        sent += batch.length;
        await processBatch(asMessages(batch), deps());
      }
    })();
    await new Promise((r) => setTimeout(r, 150));
    const repaired = await reconcileContest(stores.db, stores.redis, CONTEST_ID, { repair: true });
    await new Promise((r) => setTimeout(r, 150));
    running = false;
    await traffic;

    expect(repaired?.drift).toContainEqual(
      expect.objectContaining({ layer: 'redis_totals', key: 'C1', actual: 999_999 }),
    );
    expect(repaired?.afterRepair).toEqual([]);
    expect(await reconcileContest(stores.db, stores.redis, CONTEST_ID)).toMatchObject({
      votes: sent,
      drift: [],
    });
  });

  it('returns undefined for an unknown contest', async () => {
    expect(
      await reconcileContest(stores.db, stores.redis, '00000000-0000-4000-8000-000000000000'),
    ).toBeUndefined();
  });
});
