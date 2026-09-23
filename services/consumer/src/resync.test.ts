import type { DeadLetterEvent } from '@tally/contracts';
import { redisKeys } from '@tally/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processBatch } from './process.js';
import { createResolver } from './resolver.js';
import { resyncRedis } from './resync.js';
import { CONTEST_ID, createTestStores, voteEvent } from './test-support.js';
import { createTotalsStore } from './totals-store.js';

// "Redis must always be rebuildable from Postgres": after losing Redis, a resync restores every
// total and per-minute count exactly.

let stores: Awaited<ReturnType<typeof createTestStores>>;
beforeAll(async () => {
  stores = await createTestStores();
});
afterAll(async () => stores?.cleanup());

describe('resyncRedis', () => {
  it('rebuilds totals, totalVotes, per-minute counts and lastMinute after Redis is flushed', async () => {
    await stores.db.execute(sql`truncate votes, vote_totals, vote_buckets, dead_letters`);
    const events = Array.from({ length: 90 }, (_, i) =>
      voteEvent(`C${(i % 3) + 1}`, {
        sent_at: new Date(Date.UTC(2026, 8, 23, 23, i % 3, 5)).toISOString(),
      }),
    );
    const totals = createTotalsStore(stores.redis);
    await processBatch(
      events.map((e, i) => ({
        topic: 'votes.raw',
        partition: 0,
        offset: BigInt(i),
        value: JSON.stringify(e),
      })),
      {
        db: stores.db,
        resolver: createResolver(stores.db),
        totals,
        deadLetters: { publish: async (_: DeadLetterEvent[]) => {} },
      },
    );
    const snapshot = async () => ({
      totals: await stores.redis.hgetall(redisKeys.totals(CONTEST_ID)),
      minutes: await stores.redis.hgetall(redisKeys.minutes(CONTEST_ID)),
      meta: await stores.redis.hmget(redisKeys.meta(CONTEST_ID), 'totalVotes', 'lastMinute'),
    });
    const live = await snapshot();

    await stores.redis.flushdb();
    expect(await resyncRedis(stores.db, totals)).toMatchObject({ contests: 1, minutes: 3 });

    expect(await snapshot()).toEqual(live);
    expect(live.meta).toEqual(['90', String(Date.UTC(2026, 8, 23, 23, 2))]);
  });
});
