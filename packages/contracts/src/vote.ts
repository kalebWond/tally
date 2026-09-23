import { z } from 'zod';
import { VoteSource } from './enums.ts';

/** `POST /votes` body. `code` is normalised here so every consumer sees one canonical form. */
export const VoteRequest = z.object({
  contestId: z.uuid(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,16}$/, 'must be 1–16 letters or digits'),
  /** Raw sender identifier (phone number, device id). Hashed on arrival, never stored or logged. */
  sender: z.string().trim().min(1).max(256),
  source: VoteSource,
});
export type VoteRequest = z.infer<typeof VoteRequest>;

/** Optional client-supplied `Idempotency-Key` header, so a retried POST isn't counted twice. */
export const IdempotencyKey = z
  .string()
  .regex(/^[\x21-\x7E]{1,128}$/, 'must be 1–128 visible ASCII characters');

/** 202 body from `POST /votes`. */
export const VoteAccepted = z.object({
  eventId: z.uuid(),
  idempotencyKey: IdempotencyKey,
});
export type VoteAccepted = z.infer<typeof VoteAccepted>;

/** 4xx body from ingest. Messages describe the rule, never echo the submitted value. */
export const ErrorResponse = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Event on `votes.raw` (SPEC §6). The Go generator does not produce these — ingest does. */
export const VoteEvent = z.object({
  v: z.literal(1),
  event_id: z.uuid(),
  contest_id: z.uuid(),
  code: z.string(),
  voter_hash: z.string().regex(/^[0-9a-f]{64}$/),
  source: VoteSource,
  sent_at: z.iso.datetime(),
  idempotency_key: IdempotencyKey,
});
export type VoteEvent = z.infer<typeof VoteEvent>;
