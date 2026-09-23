import { DeadLetterEvent, redisKeys, type VoteEvent } from '@tally/contracts';
import { schema } from '@tally/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type InboundMessage, processBatch } from './process.js';
import { createResolver } from './resolver.js';
import { CODES, CONTEST_ID, createTestStores, voteEvent } from './test-support.js';
import { createTotalsStore } from './totals-store.js';

// Core of F5/F6: idempotent aggregation into Postgres (truth) and Redis (speed), and
// dead letters mirrored to votes.dead.

let stores: Awaited<ReturnType<typeof createTestStores>>;
let offset = 0n;

const asMessages = (payloads: (VoteEvent | string)[]): InboundMessage[] =>
  payloads.map((p) => ({
    topic: 'votes.raw',
    partition: 0,
    offset: offset++,
    value: typeof p === 'string' ? p : JSON.stringify(p),
  }));

let deadPublished: DeadLetterEvent[];

const deps = () => ({
  db: stores.db,
  resolver: createResolver(stores.db),
  totals: createTotalsStore(stores.redis),
  deadLetters: {
    publish: async (events: DeadLetterEvent[]) => {
      deadPublished.push(...events);
    },
  },
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
  await stores.db.execute(sql`truncate votes, vote_totals, vote_buckets, dead_letters`);
  await stores.redis.flushdb();
  deadPublished = [];
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
      { contestId: CONTEST_ID, totals: new Map([[c1.id, 3]]), totalVotes: 3, minutes: new Map() },
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

  it('dead-letters votes for a deactivated contestant as inactive_contestant; earlier votes stay counted', async () => {
    await processBatch(asMessages([voteEvent('C3'), voteEvent('C3')]), deps());
    await stores.db.execute(sql`update contestants set active = false where code = 'C3'`);

    const late = voteEvent('C3');
    const result = await processBatch(asMessages([late, voteEvent('C4')]), deps()); // fresh resolver

    expect(result).toMatchObject({ counted: 1, dead: 1 });
    expect(deadPublished).toEqual([
      expect.objectContaining({
        reason: 'inactive_contestant',
        idempotency_key: late.idempotency_key,
      }),
    ]);
    expect(await snapshot()).toMatchObject({
      votes: 3,
      total: 3,
      redisSum: 3,
      redisMatchesPg: true,
    });
    await stores.db.execute(sql`update contestants set active = true where code = 'C3'`);
  });

  it('records the contest a dead-lettered vote named, and null when the message was malformed', async () => {
    const elsewhere = '00000000-0000-4000-8000-000000000000';
    await processBatch(
      asMessages([voteEvent('ZZ9'), voteEvent('C1', { contest_id: elsewhere }), 'not json at all']),
      deps(),
    );
    const rows = await stores.db
      .select({ reason: schema.deadLetters.reason, contestId: schema.deadLetters.contestId })
      .from(schema.deadLetters);
    expect(rows).toEqual(
      expect.arrayContaining([
        { reason: 'unknown_code', contestId: CONTEST_ID },
        { reason: 'unknown_code', contestId: elsewhere },
        { reason: 'malformed', contestId: null },
      ]),
    );
  });

  it('replaying dead letters does not duplicate them', async () => {
    const batch = asMessages([voteEvent('ZZ9'), 'not json at all']);
    await processBatch(batch, deps());
    await processBatch(batch, deps());

    expect((await snapshot()).dead).toBe(2);
  });
});

describe('processBatch — votes.dead (F6)', () => {
  it('publishes each dead letter with its reason, failed_at and original payload; totals untouched', async () => {
    const unknown = voteEvent('ZZ9');
    await processBatch(asMessages([voteEvent('C2'), unknown, 'not json at all']), deps());

    expect(deadPublished).toHaveLength(2);
    for (const e of deadPublished) DeadLetterEvent.parse(e);
    const byReason = Object.fromEntries(deadPublished.map((e) => [e.reason, e]));
    expect(byReason.unknown_code).toMatchObject({
      idempotency_key: unknown.idempotency_key,
      original: unknown,
    });
    expect(byReason.malformed?.original).toEqual({ raw: 'not json at all' });
    expect((await snapshot()).total).toBe(1);
  });

  it('heals when a crash hit between the Postgres commit and the publish', async () => {
    const batch = asMessages([voteEvent('ZZ9'), voteEvent('C1')]);
    const crashing = {
      ...deps(),
      deadLetters: { publish: async () => Promise.reject(new Error('broker down')) },
    };

    await expect(processBatch(batch, crashing)).rejects.toThrow('broker down');
    expect((await snapshot()).dead).toBe(1); // in the table, not yet on the topic
    expect(deadPublished).toHaveLength(0);

    await processBatch(batch, deps()); // redelivery

    expect(deadPublished).toHaveLength(1);
    expect(await snapshot()).toMatchObject({ dead: 1, total: 1, redisSum: 1 });
  });

  it('republishes on redelivery (at-least-once) with the same key and a stable failed_at', async () => {
    const batch = asMessages([voteEvent('ZZ9')]);
    await processBatch(batch, deps());
    await new Promise((r) => setTimeout(r, 20));
    await processBatch(batch, deps());

    expect(deadPublished).toHaveLength(2);
    const [first, second] = deadPublished;
    expect(second?.idempotency_key).toBe(first?.idempotency_key);
    expect(second?.failed_at).toBe(first?.failed_at);
    expect((await snapshot()).dead).toBe(1);
  });
});

describe('processBatch — minute buckets (F17)', () => {
  const at = (iso: string) => ({ sent_at: iso });

  async function bucketCheck() {
    const { rows } = await stores.db.execute<{
      mismatched: number;
      buckets: number;
      totals: number;
    }>(sql`
      select
        (select count(*)::int from vote_totals t
           where t.total <> (select coalesce(sum(b.count), 0) from vote_buckets b where b.contestant_id = t.contestant_id)) as mismatched,
        (select coalesce(sum(count), 0)::int from vote_buckets) as buckets,
        (select coalesce(sum(total), 0)::int from vote_totals) as totals`);
    return rows[0];
  }

  it('files each vote under the minute ingest accepted it, and buckets sum to the totals', async () => {
    await processBatch(
      asMessages([
        voteEvent('C1', at('2026-09-23T20:00:59.999Z')),
        voteEvent('C1', at('2026-09-23T20:01:00.000Z')),
        voteEvent('C2', at('2026-09-23T20:01:30.000Z')),
      ]),
      deps(),
    );
    const buckets = await stores.db
      .select({ minute: schema.voteBuckets.bucketMinute, count: schema.voteBuckets.count })
      .from(schema.voteBuckets);
    const byMinute = new Map<string, number>();
    for (const b of buckets)
      byMinute.set(b.minute.toISOString(), (byMinute.get(b.minute.toISOString()) ?? 0) + b.count);
    expect(Object.fromEntries(byMinute)).toEqual({
      '2026-09-23T20:00:00.000Z': 1,
      '2026-09-23T20:01:00.000Z': 2,
    });
    expect(await bucketCheck()).toEqual({ mismatched: 0, buckets: 3, totals: 3 });
  });

  it('duplicates and replays add nothing to buckets; Redis per-minute counts match Postgres', async () => {
    const events = Array.from({ length: 300 }, (_, i) =>
      voteEvent(
        CODES[i % CODES.length] ?? 'C1',
        at(new Date(Date.UTC(2026, 8, 23, 21, i % 3, 10)).toISOString()),
      ),
    );
    const batch = asMessages([...events, ...events.slice(0, 50)]); // client retries inside the batch
    await processBatch(batch, deps());
    await processBatch(batch, deps()); // redelivery

    expect(await bucketCheck()).toEqual({ mismatched: 0, buckets: 300, totals: 300 });
    const redisMinutes = await stores.redis.hgetall(redisKeys.minutes(CONTEST_ID));
    expect(redisMinutes).toEqual({
      [String(Date.UTC(2026, 8, 23, 21, 0))]: '100',
      [String(Date.UTC(2026, 8, 23, 21, 1))]: '100',
      [String(Date.UTC(2026, 8, 23, 21, 2))]: '100',
    });
  });

  it('a redelivered batch repairs a per-minute count Redis lost', async () => {
    const batch = asMessages(
      Array.from({ length: 5 }, () => voteEvent('C4', at('2026-09-23T22:00:05Z'))),
    );
    await processBatch(batch, deps());
    await stores.redis.del(redisKeys.minutes(CONTEST_ID));
    await processBatch(batch, deps());
    expect(
      await stores.redis.hget(redisKeys.minutes(CONTEST_ID), String(Date.UTC(2026, 8, 23, 22, 0))),
    ).toBe('5');
  });
});
