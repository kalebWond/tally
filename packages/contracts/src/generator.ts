import { z } from 'zod';
import { VoteCode } from './vote.ts';

// Control API of the Go load generator (tools/generator), SPEC §7. The Go structs mirror these;
// tools/generator/contract_test.go checks them against the JSON Schemas exported from here.

const Rate = z.number().int().min(1).max(20_000);
const Ratio = z.number().min(0).max(1);

/** `POST /start`: begin a run. Codes are passed in; the generator never reads the database. */
export const GeneratorStartRequest = z.object({
  contestId: z.uuid(),
  /** Valid contestant codes to vote for. */
  codes: z.array(VoteCode).min(1).max(500),
  ratePerSec: Rate,
  /** Share of votes sent with a code that doesn't exist, which become `unknown_code` dead letters. */
  invalidCodeRatio: Ratio.default(0),
  /** Share of votes that reuse a recent sender (the same voter voting again). */
  duplicateSenderRatio: Ratio.default(0),
});
export type GeneratorStartRequest = z.infer<typeof GeneratorStartRequest>;

/** `POST /burst`: raise the running generator's rate for a while, then fall back. 409 when stopped. */
export const GeneratorBurstRequest = z.object({
  ratePerSec: Rate,
  durationSec: z.number().int().min(1).max(600),
});
export type GeneratorBurstRequest = z.infer<typeof GeneratorBurstRequest>;

/** `POST /rate`: change the running generator's base rate; counters carry on. 409 when stopped. */
export const GeneratorRateRequest = z.object({ ratePerSec: Rate });
export type GeneratorRateRequest = z.infer<typeof GeneratorRateRequest>;

/** `GET /status` and the response of every control call. Counters cover the current or last run. */
export const GeneratorStatus = z.object({
  running: z.boolean(),
  contestId: z.uuid().nullable(),
  /** Rate set by /start or /rate. */
  baseRate: z.number().int().nonnegative(),
  /** Rate in effect now: the burst rate during a burst, otherwise baseRate; 0 when stopped. */
  currentRate: z.number().int().nonnegative(),
  /** When the current burst ends (epoch ms), or null. */
  burstEndsAt: z.number().int().nullable(),
  startedAt: z.number().int().nullable(),
  /** Requests sent to ingest. */
  sentTotal: z.number().int().nonnegative(),
  /** Answered 202. */
  accepted: z.number().int().nonnegative(),
  /** Answered with any other status. */
  rejected: z.number().int().nonnegative(),
  /** Never answered: connection error or timeout. */
  failed: z.number().int().nonnegative(),
  invalidSent: z.number().int().nonnegative(),
  duplicateSent: z.number().int().nonnegative(),
  /** Ingest response time over the last few thousand requests, or null before any. */
  latencyMs: z.object({ p50: z.number(), p95: z.number(), p99: z.number() }).nullable(),
});
export type GeneratorStatus = z.infer<typeof GeneratorStatus>;
