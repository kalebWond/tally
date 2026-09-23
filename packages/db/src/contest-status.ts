import type { ContestStatus } from '@tally/contracts';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { contests } from './schema.ts';

/** Transitions an admin may make. `closed → open` is a reopen (an accidental close isn't final). */
const ALLOWED: Record<ContestStatus, readonly ContestStatus[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: ['open'],
};

export type StatusChange =
  | { ok: true; contest: typeof contests.$inferSelect }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_allowed'; from: ContestStatus };

/**
 * Opens or closes a contest, stamping `opens_at` / `closes_at` with the database clock.
 *
 * The row is locked FOR UPDATE first, which waits for every consumer batch that has the contest
 * FOR SHARE, and the timestamp is taken after that wait (`clock_timestamp()`, not `now()`, which
 * is the transaction's start). So every vote a batch counted was accepted before the stamp, and
 * every batch after it sees the new window: the cut-off is exact.
 *
 * Opening (or reopening) starts a new window: `opens_at` = now, `closes_at` cleared.
 */
export async function setContestStatus(
  db: Db,
  contestId: string,
  to: Exclude<ContestStatus, 'draft'>,
): Promise<StatusChange> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: contests.status })
      .from(contests)
      .where(eq(contests.id, contestId))
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' };
    if (!ALLOWED[current.status].includes(to)) {
      return { ok: false, reason: 'not_allowed', from: current.status };
    }
    const [contest] = await tx
      .update(contests)
      .set(
        to === 'open'
          ? { status: 'open', opensAt: sql`clock_timestamp()`, closesAt: null }
          : { status: 'closed', closesAt: sql`clock_timestamp()` },
      )
      .where(eq(contests.id, contestId))
      .returning();
    if (!contest) throw new Error('contest vanished inside its own lock');
    return { ok: true, contest };
  });
}

/**
 * Whether a contest counts a vote ingest accepted at `sentAt`: only while it was open. A vote
 * accepted before the close counts even if it's processed after it (it was sent in time); one
 * accepted after doesn't, even if it's processed before the consumer hears of the close.
 * Null `opens_at` means open since creation (the seed).
 */
export function acceptsVoteAt(
  contest: { status: ContestStatus; opensAt: Date | null; closesAt: Date | null },
  sentAt: Date,
): boolean {
  if (contest.status === 'draft') return false;
  if (contest.opensAt && sentAt < contest.opensAt) return false;
  if (contest.status === 'closed') return contest.closesAt !== null && sentAt < contest.closesAt;
  return true;
}
