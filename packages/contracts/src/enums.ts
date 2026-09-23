import { z } from 'zod';

// Value sets shared by events, API payloads and the database enums in @tally/db.

export const ContestStatus = z.enum(['draft', 'open', 'closed']);
export type ContestStatus = z.infer<typeof ContestStatus>;

export const VoteSource = z.enum(['sms', 'web', 'generator']);
export type VoteSource = z.infer<typeof VoteSource>;

export const DeadLetterReason = z.enum(['unknown_code', 'contest_closed', 'malformed']);
export type DeadLetterReason = z.infer<typeof DeadLetterReason>;
