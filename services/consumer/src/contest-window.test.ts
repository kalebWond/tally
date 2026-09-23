import type { DeadLetterEvent } from '@tally/contracts';
import { schema, setContestStatus } from '@tally/db';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type InboundMessage, processBatch } from './process.js';
import { createResolver } from './resolver.js';
import { CONTEST_ID, createTestStores, voteEvent } from './test-support.js';
import { createTotalsStore } from './totals-store.js';

// F16: a vote counts if and only if ingest accepted it while the contest was open. Closing
// mid-run must not let a single late vote through, nor drop one that was sent in time.

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
const contest = () =>
  stores.db.select().from(schema.contests).where(eq(schema.contests.id, CONTEST_ID));

beforeAll(async () => {
  stores = await createTestStores();
});
afterAll(async () => stores?.cleanup());
beforeEach(async () => {
  await stores.db.execute(sql`truncate votes, vote_totals, dead_letters`);
  await stores.db
    .update(schema.contests)
    .set({ status: 'open', opensAt: null, closesAt: null })
    .where(eq(schema.contests.id, CONTEST_ID));
});

describe('contest window', () => {
  it('after a close, counts votes accepted before it (still queued) and dead-letters the rest', async () => {
    const early = voteEvent('C1', { sent_at: new Date(Date.now() - 1000).toISOString() });
    await setContestStatus(stores.db, CONTEST_ID, 'closed');
    const late = voteEvent('C1', { sent_at: new Date(Date.now() + 1000).toISOString() });

    const result = await processBatch(asMessages([early, late]), deps());
    expect(result).toMatchObject({ counted: 1, dead: 1 });
    const [dead] = await stores.db.select().from(schema.deadLetters);
    expect(dead).toMatchObject({
      reason: 'contest_closed',
      idempotencyKey: late.idempotency_key,
      contestId: CONTEST_ID,
    });
  });

  it('dead-letters votes for a draft contest as contest_closed', async () => {
    await stores.db
      .update(schema.contests)
      .set({ status: 'draft' })
      .where(eq(schema.contests.id, CONTEST_ID));
    expect(await processBatch(asMessages([voteEvent('C2')]), deps())).toMatchObject({
      counted: 0,
      dead: 1,
    });
  });

  it('closing while batches are being processed: counted ⇔ accepted before closes_at, no vote lost', async () => {
    let running = true;
    let sent = 0;
    const loop = (async () => {
      while (running) {
        // Stamped "now", like ingest: the close lands in the middle of this stream.
        const batch = Array.from({ length: 20 }, (_, i) => voteEvent(`C${(i % 10) + 1}`));
        sent += batch.length;
        await processBatch(asMessages(batch), deps());
      }
    })();
    const loop2 = (async () => {
      while (running) {
        const batch = Array.from({ length: 20 }, (_, i) => voteEvent(`C${(i % 10) + 1}`));
        sent += batch.length;
        await processBatch(asMessages(batch), deps());
      }
    })();
    await new Promise((r) => setTimeout(r, 300));
    await setContestStatus(stores.db, CONTEST_ID, 'closed');
    await new Promise((r) => setTimeout(r, 300));
    running = false;
    await Promise.all([loop, loop2]);

    const closesAt = (await contest())[0]?.closesAt;
    if (!closesAt) throw new Error('contest not closed');
    const { rows } = await stores.db.execute<{
      counted_late: number;
      dead_early: number;
      counted: number;
      dead: number;
      total: number;
    }>(sql`
      select
        (select count(*)::int from votes where received_at >= ${closesAt}) as counted_late,
        (select count(*)::int from dead_letters d
           where (d.payload->>'sent_at')::timestamptz < ${closesAt}) as dead_early,
        (select count(*)::int from votes) as counted,
        (select count(*)::int from dead_letters where reason = 'contest_closed') as dead,
        (select coalesce(sum(total), 0)::int from vote_totals) as total`);
    const r = rows[0];
    expect(r).toMatchObject({ counted_late: 0, dead_early: 0 });
    expect(r?.counted).toBeGreaterThan(0);
    expect(r?.dead).toBeGreaterThan(0);
    expect((r?.counted ?? 0) + (r?.dead ?? 0)).toBe(sent);
    expect(r?.total).toBe(r?.counted);
  });

  // The two halves of the cut-off handshake, checked with real locks rather than timing luck.
  async function holdContest(mode: 'for share' | 'for no key update') {
    const client = new pg.Client({ connectionString: stores.databaseUrl });
    await client.connect();
    await client.query('begin');
    await client.query(`select 1 from contests where id = $1 ${mode}`, [CONTEST_ID]);
    return async () => {
      await client.query('commit');
      await client.end();
    };
  }
  const settledWithin = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => true), new Promise((r) => setTimeout(r, ms, false))]);

  it('a batch locks its contest while deciding (FOR SHARE), so it waits for a close in progress', async () => {
    // FOR NO KEY UPDATE conflicts with FOR SHARE but not with the FK checks' KEY SHARE, so only
    // the batch's explicit lock can make it wait here.
    const release = await holdContest('for no key update');
    const batch = processBatch(asMessages([voteEvent('C3')]), deps());
    expect(await settledWithin(batch, 400)).toBe(false);
    await release();
    expect(await batch).toMatchObject({ counted: 1 });
  });

  it('a close waits for batches holding the contest and stamps closes_at after they finish', async () => {
    const release = await holdContest('for share');
    const close = setContestStatus(stores.db, CONTEST_ID, 'closed');
    expect(await settledWithin(close, 400)).toBe(false);
    const releasedAt = Date.now();
    await release();
    const result = await close;
    expect(result.ok && result.contest.closesAt?.getTime()).toBeGreaterThanOrEqual(releasedAt - 50);
  });
});
