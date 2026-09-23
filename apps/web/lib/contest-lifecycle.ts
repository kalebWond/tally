import 'server-only';
import { type Contest, type ContestStatusChange, redisKeys } from '@tally/contracts';
import { type schema, setContestStatus } from '@tally/db';
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
