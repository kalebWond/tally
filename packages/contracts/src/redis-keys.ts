/**
 * Redis key layout (SPEC §5). Written by the consumer (and web, for contest status), read by the gateway. Everything here is
 * derived from Postgres and must be rebuildable from it.
 */
export const redisKeys = {
  /** Hash: contestantId → total votes. */
  totals: (contestId: string) => `tally:${contestId}:totals`,
  /**
   * Hash: `totalVotes`, `lastUpdated` (epoch ms) and `lastMinute` (latest minute with votes,
   * epoch ms) from the consumer; `status` from web on a transition.
   */
  meta: (contestId: string) => `tally:${contestId}:meta`,
  /** Hash: minute start (epoch ms) → the contest's votes in that minute (F17). */
  minutes: (contestId: string) => `tally:${contestId}:minutes`,
  /**
   * Hash (F29), system-wide: `lag:<partition>` → votes on votes.raw not yet counted, written by
   * the consumer that owns the partition; `rate:<instance>` → votes/s each consumer is counting;
   * `updatedAt` (epoch ms). Every field expires 10 s after it's written, so a stopped consumer's
   * fields disappear. Derived from Redpanda every second; read with `parseBacklog`.
   */
  backlog: 'tally:backlog',
};
