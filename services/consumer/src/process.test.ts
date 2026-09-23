import { redisKeys, type VoteEvent } from '@tally/contracts';
import { schema } from '@tally/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type InboundMessage, processBatch } from './process.js';
import { createResolver } from './resolver.js';
import { CODES, CONTEST_ID, createTestStores, voteEvent } from './test-support.js';
import { createTotalsStore } from './totals-store.js';

// Core of F5: idempotent aggregation into Postgres (truth) and Redis (speed).

let stores: Awaited<ReturnType<typeof createTestStores>>;
let offset = 0n;

const asMessages = (payloads: (VoteEvent | string)[]): InboundMessage[] =>
  payloads.map((p) => ({
    topic: 'votes.raw',
    partition: 0,
    offset: offset++,
    value: typeof p === 'string' ? p : JSON.stringify(p),
  }));

const deps = () => ({
  db: stores.db,
  resolver: createResolver(stores.db),
  totals: createTotalsStore(stores.redis),
});

async function snapshot() {
  const { rows } = await stores.db.execute<{ votes: number; total: number; dead: number }>(sql`
    select (select count(*)::int from votes) as votes,
           (select coalesce(sum(total), 0)::int from vote_totals) as total,
           (select count(*)::int from dead_letters) as dead`);
  const redisTotals = await stores.redis.hgetall(redisKeys.totals(CONTEST_ID));
  const pgTotals = await stores.db
    .select({ id: schema.voteTotals.contestantId, total: schema.voteTotals.total })
    .from(schema.voteTotals);
  const meta = await stores.redis.hgetall(redisKeys.meta(CONTEST_ID));
  return {
    ...rows[0],
    redisSum: Object.values(redisTotals).reduce((s, v) => s + Number(v), 0),
    redisMatchesPg: pgTotals.every((t) => Number(redisTotals[t.id]) === t.total),
    metaTotal: Number(meta.totalVotes ?? 0),
  };
}

beforeAll(async () => {
  stores = await createTestStores();
});

afterAll(async () => {
  await stores?.cleanup();
});

beforeEach(async () => {
  await stores.db.execute(sql`truncate votes, vote_totals, dead_letters`);
  await stores.redis.flushdb();
});

describe('processBatch', () => {
  it('1,000 votes produce totals of exactly 1,000 in Postgres and Redis', async () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      voteEvent(CODES[i % CODES.length] ?? 'C1'),
    );
    for (let i = 0; i < events.length; i += 250) {
      await processBatch(asMessages(events.slice(i, i + 250)), deps());
    }

    expect(await snapshot()).toEqual({
      votes: 1000,
      total: 1000,
      dead: 0,
      redisSum: 1000,
      redisMatchesPg: true,
      metaTotal: 1000,
    });
  });

  it('replaying the same messages changes nothing', async () => {
    const batch = asMessages(Array.from({ length: 300 }, (_, i) => voteEvent(`C${(i % 10) + 1}`)));
    await processBatch(batch, deps());
    const before = await snapshot();

    await processBatch(batch, deps());
    await processBatch(batch, deps());

    expect(await snapshot()).toEqual(before);
    expect(before.total).toBe(300);
  });

  it('counts a duplicated idempotency key once, within a batch and across batches', async () => {
    const vote = voteEvent('C3', { idempotency_key: 'client-retry-1' });
    const retry = { ...vote, event_id: crypto.randomUUID() }; // new event, same key: a client retry
    const result = await processBatch(asMessages([vote, retry]), deps());
    await processBatch(asMessages([{ ...vote, event_id: crypto.randomUUID() }]), deps());

    expect(result).toMatchObject({ counted: 1, duplicates: 1 });
    expect((await snapshot()).total).toBe(1);
  });

  it('heals Redis when a crash hit between the Postgres commit and the Redis write', async () => {
    const batch = asMessages(Array.from({ length: 50 }, () => voteEvent('C5')));
    const crashing = {
      ...deps(),
      totals: { apply: async () => Promise.reject(new Error('killed')) },
    };

    await expect(processBatch(batch, crashing)).rejects.toThrow('killed');
    const afterCrash = await snapshot();
    expect(afterCrash).toMatchObject({ total: 50, redisSum: 0 }); // Postgres committed, Redis stale

    await processBatch(batch, deps()); // redelivery: offsets were never committed

    expect(await snapshot()).toMatchObject({ total: 50, redisSum: 50, redisMatchesPg: true });
  });

  it('never lowers a Redis count when an older total arrives late', async () => {
    await processBatch(asMessages(Array.from({ length: 10 }, () => voteEvent('C1'))), deps());
    const [c1] = await stores.db
      .select({ id: schema.voteTotals.contestantId })
      .from(schema.voteTotals);
    if (!c1) throw new Error('no total written');

    // A stale writer (e.g. a consumer mid-rebalance) tries to set an older, smaller total.
    await createTotalsStore(stores.redis).apply([
      { contestId: CONTEST_ID, totals: new Map([[c1.id, 3]]), totalVotes: 3 },
    ]);

    expect(Number(await stores.redis.hget(redisKeys.totals(CONTEST_ID), c1.id))).toBe(10);
  });

  it('dead-letters unknown codes, unknown contests and malformed messages without touching totals', async () => {
    const result = await processBatch(
      asMessages([
        voteEvent('C1'),
        voteEvent('ZZ9'),
        voteEvent('C1', { contest_id: '00000000-0000-4000-8000-000000000000' }),
        '{"not":"a vote"}',
        'not json at all',
      ]),
      deps(),
    );

    expect(result).toMatchObject({ counted: 1, dead: 4 });
    const reasons = await stores.db
      .select({ reason: schema.deadLetters.reason })
      .from(schema.deadLetters);
    expect(reasons.map((r) => r.reason).sort()).toEqual([
      'malformed',
      'malformed',
      'unknown_code',
      'unknown_code',
    ]);
    expect((await snapshot()).total).toBe(1);
  });

  it('replaying dead letters does not duplicate them', async () => {
    const batch = asMessages([voteEvent('ZZ9'), 'not json at all']);
    await processBatch(batch, deps());
    await processBatch(batch, deps());

    expect((await snapshot()).dead).toBe(2);
  });
});
