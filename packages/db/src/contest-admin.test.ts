import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContest, deleteContest } from './contest-admin.ts';
import { setContestStatus } from './contest-status.ts';
import { contestants, contests, votes } from './schema.ts';
import { SEED_CONTEST_ID } from './seed.ts';
import { createTestDatabase } from './testing.ts';

let test: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  test = await createTestDatabase();
});
afterAll(async () => test?.cleanup());

const created = async (name: string) => {
  const result = await createContest(test.db, name);
  if (!result.ok) throw new Error(`${name} not created`);
  return result.contest;
};
const addContestant = (contestId: string, code: string, active = true) =>
  test.db.insert(contestants).values({ contestId, code, name: `Contestant ${code}`, active });

describe('createContest', () => {
  it('creates a draft', async () => {
    const contest = await created('Spring Heats');
    expect(contest).toMatchObject({ name: 'Spring Heats', status: 'draft', opensAt: null });
  });

  it('refuses a name already taken in any case, naming the holder', async () => {
    expect(await createContest(test.db, 'SPRING heats')).toEqual({
      ok: false,
      reason: 'name_taken',
      holder: 'Spring Heats',
    });
  });
});

describe('opening needs an active contestant', () => {
  it('refuses a contest with none, or only inactive ones, then opens once one is active', async () => {
    const contest = await created('Opening Guard');
    expect(await setContestStatus(test.db, contest.id, 'open')).toEqual({
      ok: false,
      reason: 'no_contestants',
    });
    await addContestant(contest.id, 'A1', false);
    expect(await setContestStatus(test.db, contest.id, 'open')).toMatchObject({
      ok: false,
      reason: 'no_contestants',
    });
    await addContestant(contest.id, 'A2');
    expect(await setContestStatus(test.db, contest.id, 'open')).toMatchObject({
      ok: true,
      contest: { status: 'open' },
    });
  });

  it('closing doesn’t need one', async () => {
    const contest = await created('Close Without');
    await addContestant(contest.id, 'B1');
    await setContestStatus(test.db, contest.id, 'open');
    await test.db
      .update(contestants)
      .set({ active: false })
      .where(eq(contestants.contestId, contest.id));
    expect(await setContestStatus(test.db, contest.id, 'closed')).toMatchObject({ ok: true });
  });
});

describe('deleteContest', () => {
  it('deletes a draft and its contestants, freeing the name', async () => {
    const contest = await created('Throwaway');
    await addContestant(contest.id, 'T1');
    await addContestant(contest.id, 'T2');
    expect(await deleteContest(test.db, contest.id)).toEqual({ ok: true });
    expect(await test.db.select().from(contests).where(eq(contests.id, contest.id))).toEqual([]);
    expect(
      await test.db.select().from(contestants).where(eq(contestants.contestId, contest.id)),
    ).toEqual([]);
    expect((await createContest(test.db, 'throwaway')).ok).toBe(true);
  });

  it('refuses anything that isn’t a draft, so results are never deleted', async () => {
    expect(await deleteContest(test.db, SEED_CONTEST_ID)).toEqual({
      ok: false,
      reason: 'not_draft',
      status: 'open',
    });
    expect(
      await test.db.select().from(contests).where(eq(contests.id, SEED_CONTEST_ID)),
    ).toHaveLength(1);
  });

  it('refuses a draft that somehow has votes', async () => {
    const contest = await created('Has Votes');
    const [who] = await addContestant(contest.id, 'V1').returning();
    await test.db.insert(votes).values({
      contestId: contest.id,
      contestantId: who?.id,
      codeSubmitted: 'V1',
      voterHash: 'h',
      source: 'web',
      idempotencyKey: 'contest-admin-test',
      receivedAt: new Date(),
    });
    expect(await deleteContest(test.db, contest.id)).toEqual({ ok: false, reason: 'has_votes' });
  });

  it('reports an unknown contest', async () => {
    expect(await deleteContest(test.db, '00000000-0000-4000-8000-000000000000')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
