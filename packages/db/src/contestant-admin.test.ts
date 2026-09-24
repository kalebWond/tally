import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContest } from './contest-admin.ts';
import { createContestants } from './contestant-admin.ts';
import { contestants } from './schema.ts';
import { createTestDatabase } from './testing.ts';

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let contestId: string;
beforeAll(async () => {
  test = await createTestDatabase();
  const created = await createContest(test.db, 'Batch Heats');
  if (!created.ok) throw new Error('no contest');
  contestId = created.contest.id;
});
afterAll(async () => test?.cleanup());

const row = (code: string, name = `Contestant ${code}`) => ({ code, name });
const codes = async () =>
  (
    await test.db
      .select({ code: contestants.code })
      .from(contestants)
      .where(eq(contestants.contestId, contestId))
  )
    .map((r) => r.code)
    .sort();

describe('createContestants', () => {
  it('adds every row, active', async () => {
    const result = await createContestants(test.db, contestId, [row('B1'), row('B2'), row('B3')]);
    expect(result.ok && result.contestants.map((c) => [c.code, c.active])).toEqual([
      ['B1', true],
      ['B2', true],
      ['B3', true],
    ]);
  });

  it('adds none when one code is taken, and says which row and who holds it', async () => {
    const result = await createContestants(test.db, contestId, [
      row('B4'),
      row('B2', 'Late Comer'),
      row('B5'),
    ]);
    expect(result).toEqual({
      ok: false,
      reason: 'codes_taken',
      taken: [{ index: 1, code: 'B2', holder: 'Contestant B2' }],
    });
    expect(await codes()).toEqual(['B1', 'B2', 'B3']);
  });

  it('reports an unknown contest', async () => {
    expect(
      await createContestants(test.db, '00000000-0000-4000-8000-000000000000', [row('X1')]),
    ).toEqual({ ok: false, reason: 'no_contest' });
  });
});
