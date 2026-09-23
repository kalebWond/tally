import { DeadLetterQuery, type DeadLetterReason } from '@tally/contracts';
import { type Db, SEED_CONTEST_ID, schema } from '@tally/db';
import { createTestDatabase } from '@tally/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { countDeadLetters, queryDeadLetters } from './dead-letters';

// F15: the browser must show every dead letter exactly once while paging, even as new ones
// arrive mid-browse, and filter by contest and reason. Runs on a throwaway database.

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
const OTHER = '00000000-0000-4000-8000-000000000000';
let n = 0;

async function insert(
  count: number,
  reason: DeadLetterReason,
  contestId: string | null = SEED_CONTEST_ID,
) {
  await db.insert(schema.deadLetters).values(
    Array.from({ length: count }, () => ({
      idempotencyKey: `k${n++}`,
      contestId,
      reason,
      payload: { code: 'XZZ', contest_id: contestId },
    })),
  );
}

const q = (input: Record<string, unknown>) => DeadLetterQuery.parse(input);

beforeAll(async () => {
  test = await createTestDatabase();
  db = test.db;
});
afterAll(async () => test?.cleanup());
beforeEach(async () => {
  await db.execute(sql`truncate dead_letters restart identity`);
});

describe('queryDeadLetters', () => {
  it('walks every row exactly once, newest first, even while new rows arrive mid-walk', async () => {
    await insert(120, 'unknown_code');
    const seen: number[] = [];
    let page = await queryDeadLetters(db, q({ limit: 50 }));
    seen.push(...page.items.map((i) => i.id));
    await insert(30, 'unknown_code'); // a generator run keeps going while someone browses
    while (page.older !== null) {
      page = await queryDeadLetters(db, q({ limit: 50, before: page.older }));
      seen.push(...page.items.map((i) => i.id));
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(seen.at(-1)).toBe(1);
  });

  it('pages back towards the newest with `after`, and the newest page says so', async () => {
    await insert(100, 'unknown_code');
    const top = await queryDeadLetters(db, q({ limit: 40 }));
    expect(top.newer).toBeNull();
    const second = await queryDeadLetters(db, q({ limit: 40, before: top.older }));
    const back = await queryDeadLetters(db, q({ limit: 40, after: second.newer }));
    expect(back.items.map((i) => i.id)).toEqual(top.items.map((i) => i.id));
    expect(back.newer).toBeNull();
  });

  it('the oldest page has no older cursor, so there is never an empty "Older" page', async () => {
    await insert(50, 'unknown_code');
    const page = await queryDeadLetters(db, q({ limit: 50 }));
    expect(page.items).toHaveLength(50);
    expect(page.older).toBeNull();
  });

  it('filters by contest and reason, and cursors stay within the filter', async () => {
    await insert(10, 'unknown_code');
    await insert(5, 'inactive_contestant');
    await insert(7, 'unknown_code', OTHER);
    await insert(3, 'malformed', null);

    const inactive = await queryDeadLetters(
      db,
      q({ contestId: SEED_CONTEST_ID, reason: 'inactive_contestant', limit: 3 }),
    );
    expect(
      inactive.items.every(
        (i) => i.reason === 'inactive_contestant' && i.contestId === SEED_CONTEST_ID,
      ),
    ).toBe(true);
    const rest = await queryDeadLetters(
      db,
      q({
        contestId: SEED_CONTEST_ID,
        reason: 'inactive_contestant',
        limit: 3,
        before: inactive.older,
      }),
    );
    expect(rest.items).toHaveLength(2);
    expect(rest.older).toBeNull();

    expect((await queryDeadLetters(db, q({ contestId: OTHER }))).items).toHaveLength(7);
    expect(
      (await queryDeadLetters(db, q({ reason: 'malformed' }))).items.every(
        (i) => i.contestId === null,
      ),
    ).toBe(true);
  });
});

describe('countDeadLetters', () => {
  it('counts per reason, with every reason present, and only newer rows given `since`', async () => {
    await insert(4, 'unknown_code');
    await insert(2, 'inactive_contestant');
    await insert(9, 'unknown_code', OTHER);
    const all = await countDeadLetters(db, { contestId: SEED_CONTEST_ID });
    expect(all).toEqual({
      total: 6,
      byReason: { unknown_code: 4, inactive_contestant: 2, contest_closed: 0, malformed: 0 },
      latestId: 6,
    });

    await insert(3, 'unknown_code');
    const fresh = await countDeadLetters(db, {
      contestId: SEED_CONTEST_ID,
      since: all.latestId ?? 0,
    });
    expect(fresh).toMatchObject({ total: 3, byReason: { unknown_code: 3 } });
  });
});
