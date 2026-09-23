/**
 * Redis key layout (SPEC §5). Written by the consumer (and web, for contest status), read by the gateway. Everything here is
 * derived from Postgres and must be rebuildable from it.
 */
export const redisKeys = {
  /** Hash: contestantId → total votes. */
  totals: (contestId: string) => `tally:${contestId}:totals`,
  /** Hash: `totalVotes`, `lastUpdated` (epoch ms), both from the consumer; `status` from web on a transition. */
  meta: (contestId: string) => `tally:${contestId}:meta`,
};
