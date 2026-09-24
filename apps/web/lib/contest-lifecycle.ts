import 'server-only';
import { type Contest, type ContestStatusChange, redisKeys } from '@tally/contracts';
import { createContest, deleteContest, type schema, setContestStatus } from '@tally/db';
import { db } from './db';
import { redis } from './redis';

export const toContest = (c: typeof schema.contests.$inferSelect): Contest => ({
  id: c.id,
  name: c.name,
  status: c.status,
  opensAt: c.opensAt?.toISOString() ?? null,
  closesAt: c.closesAt?.toISOString() ?? null,
});

/**
 * Opens or closes a contest in Postgres (the cut-off: see setContestStatus), then mirrors the
 * new status into the contest's Redis meta hash so the gateway tells open results pages. The
 * mirror is best-effort: Postgres already decided, and the consumer enforces it either way.
 */
export async function changeContestStatus(contestId: string, to: ContestStatusChange['status']) {
  const result = await setContestStatus(db(), contestId, to);
  if (!result.ok) return result;
  let liveUpdated = true;
  try {
    await redis().hset(redisKeys.meta(contestId), 'status', result.contest.status);
  } catch {
    liveUpdated = false;
  }
  return { ok: true as const, contest: toContest(result.contest), liveUpdated };
}

/** Creates a draft contest (F26); a name already taken, ignoring case, comes back as a conflict. */
export async function addContest(name: string) {
  const result = await createContest(db(), name);
  return result.ok ? { ok: true as const, contest: toContest(result.contest) } : result;
}

/** Deletes a draft contest and its contestants (F26). Nothing else is ever deleted. */
export const removeContest = (contestId: string) => deleteContest(db(), contestId);
