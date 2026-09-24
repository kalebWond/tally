import type { ContestStatus } from '@tally/contracts';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { pgCode } from './pg-error.ts';
import { contestants, contests, votes } from './schema.ts';

type Contest = typeof contests.$inferSelect;

export type ContestCreated =
  | { ok: true; contest: Contest }
  | { ok: false; reason: 'name_taken'; holder: string };

/**
 * Creates a draft contest. Uniqueness (ignoring case) is left to Postgres
 * (`contests_name_unique`), not checked first, so two admins can't both take a name.
 */
export async function createContest(db: Db, name: string): Promise<ContestCreated> {
  try {
    const [contest] = await db.insert(contests).values({ name }).returning();
    if (!contest) throw new Error('insert returned no row');
    return { ok: true, contest };
  } catch (err) {
    if (pgCode(err) !== '23505') throw err;
    const [holder] = await db
      .select({ name: contests.name })
      .from(contests)
      .where(sql`lower(${contests.name}) = lower(${name})`);
    return { ok: false, reason: 'name_taken', holder: holder?.name ?? name };
  }
}

export type ContestDeleted =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_draft'; status: ContestStatus }
  | { ok: false; reason: 'has_votes' };

/**
 * Deletes a draft contest and its contestants. Only drafts: a contest that has ever opened can't
 * go back to draft, so a draft never counted a vote, and deleting one loses no results. Votes
 * sent to it while it was a draft stay in dead letters. The vote check is a second guard; the
 * foreign keys from `votes` would refuse the delete anyway.
 */
export async function deleteContest(db: Db, contestId: string): Promise<ContestDeleted> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: contests.status })
      .from(contests)
      .where(eq(contests.id, contestId))
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' };
    if (current.status !== 'draft')
      return { ok: false, reason: 'not_draft', status: current.status };
    const [vote] = await tx
      .select({ id: votes.id })
      .from(votes)
      .where(eq(votes.contestId, contestId))
      .limit(1);
    if (vote) return { ok: false, reason: 'has_votes' };
    await tx.delete(contestants).where(eq(contestants.contestId, contestId));
    await tx.delete(contests).where(eq(contests.id, contestId));
    return { ok: true };
  });
}
