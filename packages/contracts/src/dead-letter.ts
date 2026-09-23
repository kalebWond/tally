import { z } from 'zod';
import { DeadLetterReason } from './enums.ts';

/**
 * Event on `votes.dead` (SPEC §6), mirrored row for row in the `dead_letters` table.
 * Delivery is at-least-once: a redelivered or replayed batch republishes its dead letters,
 * so readers dedupe on `idempotency_key`.
 */
export const DeadLetterEvent = z.object({
  v: z.literal(1),
  reason: DeadLetterReason,
  /** When the consumer first dead-lettered it. Stable across republishes. */
  failed_at: z.iso.datetime(),
  /** The vote's idempotency key, or `offset:topic/partition/offset` for a malformed message. */
  idempotency_key: z.string(),
  /** The message as received: the parsed JSON, or `{ raw }` if it was not JSON. */
  original: z.unknown(),
});
export type DeadLetterEvent = z.infer<typeof DeadLetterEvent>;

// Admin dead-letter browser (SPEC §7): GET /api/dead-letters, GET /api/dead-letters/counts.

/** Row id as a cursor: query strings arrive as text. */
const Cursor = z.coerce.number().int().positive();

/**
 * `GET /api/dead-letters`: newest first, keyset-paginated on id so pages stay put while new
 * dead letters arrive. Pass `before` (the page's `older` cursor) or `after` (its `newer` one),
 * not both.
 */
export const DeadLetterQuery = z
  .object({
    contestId: z.uuid().optional(),
    reason: DeadLetterReason.optional(),
    before: Cursor.optional(),
    after: Cursor.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => q.before === undefined || q.after === undefined, 'pass before or after, not both');
export type DeadLetterQuery = z.infer<typeof DeadLetterQuery>;

/** One dead letter as the admin API shows it. `payload` is the message as received. */
export const DeadLetterRow = z.object({
  id: z.number().int(),
  reason: DeadLetterReason,
  contestId: z.uuid().nullable(),
  idempotencyKey: z.string().nullable(),
  receivedAt: z.iso.datetime(),
  payload: z.unknown(),
});
export type DeadLetterRow = z.infer<typeof DeadLetterRow>;

export const DeadLetterPage = z.object({
  items: z.array(DeadLetterRow),
  /** Pass as `before` for the next older page; null at the oldest. */
  older: z.number().int().nullable(),
  /** Pass as `after` for the next newer page; null when this page is the newest. */
  newer: z.number().int().nullable(),
});
export type DeadLetterPage = z.infer<typeof DeadLetterPage>;

/** `GET /api/dead-letters/counts?contestId=&since=`: per reason, optionally only ids above `since`. */
export const DeadLetterCountsQuery = z.object({
  contestId: z.uuid().optional(),
  since: z.coerce.number().int().nonnegative().optional(),
});
export const DeadLetterCounts = z.object({
  total: z.number().int().nonnegative(),
  byReason: z.record(DeadLetterReason, z.number().int().nonnegative()),
  /** Highest id counted, for the next `since`; null when there are none. */
  latestId: z.number().int().nullable(),
});
export type DeadLetterCounts = z.infer<typeof DeadLetterCounts>;
