import { z } from 'zod';
import { DeadLetterReason } from './enums.js';

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
