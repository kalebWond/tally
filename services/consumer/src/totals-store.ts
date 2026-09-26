import { redisKeys } from '@tally/contracts';
import type { Redis } from 'ioredis';

export interface ContestTotals {
  contestId: string;
  /** contestantId → absolute total, as committed in Postgres. */
  totals: Map<string, number>;
  /** Minute start (epoch ms) → contestantId → that contestant's votes in that minute. */
  minutes: Map<number, Map<string, number>>;
}

/**
 * One contest's update, atomically. Per-contestant values are set only if higher than what Redis
 * holds: totals only grow, so a stale writer (a late batch, a consumer mid-rebalance) can never
 * drag a count backwards. The contest-wide figures are then summed here from those values, which
 * are each exact: summed in Postgres, two consumers' batches for different contestants each
 * missed the other's uncommitted votes (F37). Sums are written upward-only too.
 * KEYS: totals, contestant-minutes, minutes, meta.
 * ARGV: now, n, contestantId, total (n pairs), m, minute, contestantId, count (m triples).
 */
const APPLY = `
local function raise(key, field, value)
  local current = tonumber(redis.call('HGET', key, field) or '-1')
  if tonumber(value) > current then redis.call('HSET', key, field, value) end
end
local i = 2
local n = tonumber(ARGV[i]); i = i + 1
for _ = 1, n do raise(KEYS[1], ARGV[i], ARGV[i + 1]); i = i + 2 end
local m = tonumber(ARGV[i]); i = i + 1
local touched, latest = {}, nil
for _ = 1, m do
  local minute = ARGV[i]
  raise(KEYS[2], minute .. ':' .. ARGV[i + 1], ARGV[i + 2])
  touched[minute] = true
  if latest == nil or tonumber(minute) > latest then latest = tonumber(minute) end
  i = i + 3
end
local sum = 0
for _, v in ipairs(redis.call('HVALS', KEYS[1])) do sum = sum + tonumber(v) end
raise(KEYS[4], 'totalVotes', string.format('%d', sum))
if latest ~= nil then
  local ids = redis.call('HKEYS', KEYS[1])
  for minute in pairs(touched) do
    local count = 0
    for _, id in ipairs(ids) do
      count = count + tonumber(redis.call('HGET', KEYS[2], minute .. ':' .. id) or '0')
    end
    raise(KEYS[3], minute, string.format('%d', count))
  end
  -- Where a closed contest's chart window ends (F17).
  raise(KEYS[4], 'lastMinute', string.format('%d', latest))
end
redis.call('HSET', KEYS[4], 'lastUpdated', ARGV[1])
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
      for (const { contestId, totals, minutes } of updates) {
        const perContestant = [...totals].flatMap(([id, total]) => [id, String(total)]);
        const perMinute = [...minutes].flatMap(([minute, counts]) =>
          [...counts].flatMap(([id, count]) => [String(minute), id, String(count)]),
        );
        pipeline.eval(
          APPLY,
          4,
          redisKeys.totals(contestId),
          redisKeys.contestantMinutes(contestId),
          redisKeys.minutes(contestId),
          redisKeys.meta(contestId),
          now,
          String(totals.size),
          ...perContestant,
          String(perMinute.length / 3),
          ...perMinute,
        );
      }
      const results = await pipeline.exec();
      const failed = results?.find(([err]) => err);
      if (failed?.[0]) throw failed[0];
    },
  };
}

export type TotalsStore = Pick<ReturnType<typeof createTotalsStore>, 'apply'>;
