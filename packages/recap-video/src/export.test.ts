import { randomUUID } from 'node:crypto';
import { type Db, SEED_CONTEST_ID, schema } from '@tally/db';
import { createTestDatabase } from '@tally/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportRecap } from './export.ts';

// F25: the video's data must be the contest's real history, ending exactly on the final totals.

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
beforeAll(async () => {
  test = await createTestDatabase();
  db = test.db;
});
afterAll(async () => test?.cleanup());

async function castVotes(code: string, at: Date, count: number) {
  const [c] = await db
    .select({ id: schema.contestants.id })
    .from(schema.contestants)
    .where(eq(schema.contestants.code, code));
  if (!c) throw new Error(code);
  await db.insert(schema.votes).values(
    Array.from({ length: count }, () => ({
      contestId: SEED_CONTEST_ID,
      contestantId: c.id,
      codeSubmitted: code,
      voterHash: 'x'.repeat(64),
      source: 'sms' as const,
      idempotencyKey: randomUUID(),
      receivedAt: at,
    })),
  );
  await db
    .insert(schema.voteTotals)
    .values({ contestantId: c.id, total: count })
    .onConflictDoUpdate({
      target: schema.voteTotals.contestantId,
      set: { total: sql`${schema.voteTotals.total} + ${count}` },
    });
}

describe('exportRecap', () => {
  it('builds the race from the vote log: starts at zero, never goes backwards, ends on the final totals, skips quiet gaps', async () => {
    const t0 = Date.UTC(2026, 8, 24, 20, 0, 0);
    await castVotes('C1', new Date(t0), 30);
    await castVotes('C2', new Date(t0 + 20_000), 10);
    await castVotes('C2', new Date(t0 + 40_000), 40); // C2 overtakes
    await castVotes('C1', new Date(t0 + 3 * 3600_000), 5); // three quiet hours, then a little more

    const data = await exportRecap(db, SEED_CONTEST_ID);
    const id = (code: string) => data.contestants.find((c) => c.code === code)?.id ?? '';
    const final = data.steps.at(-1)?.totals ?? {};

    expect(data.totalVotes).toBe(85);
    expect(data.contestants.slice(0, 2).map((c) => [c.code, c.total])).toEqual([
      ['C2', 50],
      ['C1', 35],
    ]);
    expect(Object.values(data.steps[0]?.totals ?? {}).every((v) => v === 0)).toBe(true);
    expect(final[id('C2')]).toBe(50);
    expect(final[id('C1')]).toBe(35);
    for (let i = 1; i < data.steps.length; i++) {
      for (const c of data.contestants)
        expect(data.steps[i]?.totals[c.id]).toBeGreaterThanOrEqual(
          data.steps[i - 1]?.totals[c.id] ?? 0,
        );
    }
    // Buckets with votes only: 3 hours of silence is one step, not ~100 empty ones.
    expect(data.steps.length).toBeLessThanOrEqual(6);
    expect(data.contestants).toHaveLength(10);
  });
});
