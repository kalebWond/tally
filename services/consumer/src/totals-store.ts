import { redisKeys } from '@tally/contracts';
import type { Redis } from 'ioredis';

export interface ContestTotals {
  contestId: string;
  /** contestantId → absolute total, as committed in Postgres. */
  totals: Map<string, number>;
  /** Sum across the contest, as committed in Postgres. */
  totalVotes: number;
  /** Minute start (epoch ms) → the contest's votes in that minute, for the minutes this batch touched. */
  minutes: Map<number, number>;
}

// Sets each field to the given absolute value only if it is higher than what Redis holds.
// Totals only grow, so a stale writer (a late batch, a consumer mid-rebalance) can never
// drag a count backwards. KEYS[1] = hash; ARGV = field1, value1, field2, value2, …
const SET_IF_HIGHER = `
for i = 1, #ARGV, 2 do
  local current = tonumber(redis.call('HGET', KEYS[1], ARGV[i]) or '-1')
  if tonumber(ARGV[i + 1]) > current then
    redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
  end
end
return 1
`;

/**
 * Mirrors Postgres totals into Redis. Writes absolute values rather than increments, so applying
 * the same update twice (redelivery after a crash) is harmless and heals any gap.
 */
export function createTotalsStore(redis: Redis) {
  return {
    async apply(updates: ContestTotals[]) {
      if (updates.length === 0) return;
      const now = String(Date.now());
      const pipeline = redis.pipeline();
      for (const { contestId, totals, totalVotes, minutes } of updates) {
        const args = [...totals].flatMap(([id, total]) => [id, String(total)]);
        pipeline.eval(SET_IF_HIGHER, 1, redisKeys.totals(contestId), ...args);
        if (minutes.size) {
          const perMinute = [...minutes].flatMap(([minute, count]) => [
            String(minute),
            String(count),
          ]);
          pipeline.eval(SET_IF_HIGHER, 1, redisKeys.minutes(contestId), ...perMinute);
          // Where a closed contest's chart window ends (F17).
          const latest = String(Math.max(...minutes.keys()));
          pipeline.eval(SET_IF_HIGHER, 1, redisKeys.meta(contestId), 'lastMinute', latest);
        }
        pipeline.eval(
          SET_IF_HIGHER,
          1,
          redisKeys.meta(contestId),
          'totalVotes',
          String(totalVotes),
        );
        pipeline.hset(redisKeys.meta(contestId), 'lastUpdated', now);
      }
      const results = await pipeline.exec();
      const failed = results?.find(([err]) => err);
      if (failed?.[0]) throw failed[0];
    },
  };
}

export type TotalsStore = Pick<ReturnType<typeof createTotalsStore>, 'apply'>;
