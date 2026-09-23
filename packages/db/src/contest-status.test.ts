import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptsVoteAt, setContestStatus } from './contest-status.ts';
import { contests } from './schema.ts';
import { SEED_CONTEST_ID } from './seed.ts';
import { createTestDatabase } from './testing.ts';

const t = (s: number) => new Date(Date.UTC(2026, 8, 23, 20, 0, s));

describe('acceptsVoteAt', () => {
  it('counts nothing for a draft contest', () => {
    expect(acceptsVoteAt({ status: 'draft', opensAt: null, closesAt: null }, t(0))).toBe(false);
  });

  it('counts votes accepted since it opened; null opens_at means open since creation', () => {
    const open = { status: 'open' as const, opensAt: t(10), closesAt: null };
    expect(acceptsVoteAt(open, t(9))).toBe(false);
    expect(acceptsVoteAt(open, t(10))).toBe(true);
    expect(acceptsVoteAt({ ...open, opensAt: null }, t(0))).toBe(true);
  });

  it('after a close, counts only votes accepted before closes_at, however late they are processed', () => {
    const closed = { status: 'closed' as const, opensAt: t(10), closesAt: t(20) };
    expect(acceptsVoteAt(closed, t(19))).toBe(true);
    expect(acceptsVoteAt(closed, t(20))).toBe(false);
    expect(acceptsVoteAt(closed, t(5))).toBe(false);
  });
});

describe('setContestStatus', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(async () => test?.cleanup());

  it('closes, stamping closes_at; reopening starts a new window', async () => {
    const closed = await setContestStatus(test.db, SEED_CONTEST_ID, 'closed');
    expect(closed).toMatchObject({
      ok: true,
      contest: { status: 'closed', closesAt: expect.any(Date) },
    });

    const reopened = await setContestStatus(test.db, SEED_CONTEST_ID, 'open');
    expect(reopened).toMatchObject({ ok: true, contest: { status: 'open', closesAt: null } });
    if (closed.ok && reopened.ok)
      expect(reopened.contest.opensAt?.getTime()).toBeGreaterThanOrEqual(
        closed.contest.closesAt?.getTime() ?? Infinity,
      );
  });

  it('refuses transitions that make no sense, and unknown contests', async () => {
    expect(await setContestStatus(test.db, SEED_CONTEST_ID, 'open')).toEqual({
      ok: false,
      reason: 'not_allowed',
      from: 'open',
    });
    await test.db.update(contests).set({ status: 'draft' }).where(eq(contests.id, SEED_CONTEST_ID));
    expect(await setContestStatus(test.db, SEED_CONTEST_ID, 'closed')).toEqual({
      ok: false,
      reason: 'not_allowed',
      from: 'draft',
    });
    expect(await setContestStatus(test.db, '00000000-0000-4000-8000-000000000000', 'open')).toEqual(
      { ok: false, reason: 'not_found' },
    );
  });
});
