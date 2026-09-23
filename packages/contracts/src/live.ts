import { z } from 'zod';
import { ContestStatus } from './enums.ts';

// Gateway protocol (SPEC §7): WS /live?contestId=…
// A snapshot on connect, then updates carrying only the contestants whose total changed.
// Totals are absolute, never increments: a client that misses a frame is still correct after
// the next one, and each value is a new target for the counter animation (F9).

export const LiveTotal = z.object({
  contestantId: z.uuid(),
  total: z.number().int().nonnegative(),
});
export type LiveTotal = z.infer<typeof LiveTotal>;

/**
 * The contest's status as last written to Redis by the admin (F16), so an open results page
 * learns of a close without a reload. Null when Redis doesn't have it: the page keeps the status
 * it was rendered with.
 */
const LiveStatus = ContestStatus.nullable();

export const LiveSnapshot = z.object({
  type: z.literal('snapshot'),
  contestId: z.uuid(),
  totals: z.array(LiveTotal),
  totalVotes: z.number().int().nonnegative(),
  status: LiveStatus,
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
  /** Sent on every update; a status change alone also produces one (with `changed` empty). */
  status: LiveStatus,
  ts: z.number().int(),
});
export type LiveUpdate = z.infer<typeof LiveUpdate>;

/**
 * Sent every HEARTBEAT_MS. The browser can't see WebSocket-level pings and updates only flow when
 * totals change, so without this a silently dead connection (dropped Wi-Fi, sleeping laptop)
 * would look live indefinitely.
 */
export const LiveHeartbeat = z.object({
  type: z.literal('heartbeat'),
  ts: z.number().int(),
});
export type LiveHeartbeat = z.infer<typeof LiveHeartbeat>;

export const LiveMessage = z.discriminatedUnion('type', [LiveSnapshot, LiveUpdate, LiveHeartbeat]);
export type LiveMessage = z.infer<typeof LiveMessage>;

/** Gateway sends a heartbeat at least this often. */
export const HEARTBEAT_MS = 15_000;
/** A client that hears nothing for this long treats the connection as dead and reconnects. */
export const STALE_AFTER_MS = 35_000;

/** Application close codes (4000–4999 range reserved for apps by RFC 6455). */
export const LiveCloseCodes = {
  /** `contestId` missing or not a UUID. Reconnecting won't help. */
  invalidContest: 4400,
  /** Gateway shutting down. Reconnect with backoff (F11). */
  goingAway: 1001,
} as const;
