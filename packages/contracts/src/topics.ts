/** Topic names are part of the contract, not configuration: every producer and consumer agrees on them. */
export const TOPICS = {
  /** Accepted votes, keyed by code. */
  raw: 'votes.raw',
  /** Votes that could not be counted, with a reason. */
  dead: 'votes.dead',
} as const;
