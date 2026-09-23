import { z } from 'zod';

// Gateway protocol (SPEC §7): WS /live?contestId=…
// A snapshot on connect, then updates carrying only the contestants whose total changed.
// Totals are absolute, never increments: a client that misses a frame is still correct after
// the next one, and each value is a new target for the counter animation (F9).

export const LiveTotal = z.object({
  contestantId: z.uuid(),
  total: z.number().int().nonnegative(),
});
export type LiveTotal = z.infer<typeof LiveTotal>;

export const LiveSnapshot = z.object({
  type: z.literal('snapshot'),
  contestId: z.uuid(),
  totals: z.array(LiveTotal),
  totalVotes: z.number().int().nonnegative(),
  /** Server time of the read, epoch ms. */
  ts: z.number().int(),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshot>;

export const LiveUpdate = z.object({
  type: z.literal('update'),
  contestId: z.uuid(),
  /** Only the contestants whose total changed since the previous frame. */
  changed: z.array(LiveTotal),
  totalVotes: z.number().int().nonnegative(),
  ts: z.number().int(),
});
export type LiveUpdate = z.infer<typeof LiveUpdate>;

export const LiveMessage = z.discriminatedUnion('type', [LiveSnapshot, LiveUpdate]);
export type LiveMessage = z.infer<typeof LiveMessage>;

/** Application close codes (4000–4999 range reserved for apps by RFC 6455). */
export const LiveCloseCodes = {
  /** `contestId` missing or not a UUID. Reconnecting won't help. */
  invalidContest: 4400,
  /** Gateway shutting down. Reconnect with backoff (F11). */
  goingAway: 1001,
} as const;
