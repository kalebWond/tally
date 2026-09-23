import { z } from 'zod';

// Value sets shared by events, API payloads and the database enums in @tally/db.
// The `as const` tuples are what Drizzle's pgEnum needs (a non-empty tuple type), and they keep
// the Zod enums and Postgres enums built from one list.

export const CONTEST_STATUSES = ['draft', 'open', 'closed'] as const;
export const ContestStatus = z.enum(CONTEST_STATUSES);
export type ContestStatus = z.infer<typeof ContestStatus>;

export const VOTE_SOURCES = ['sms', 'web', 'generator'] as const;
export const VoteSource = z.enum(VOTE_SOURCES);
export type VoteSource = z.infer<typeof VoteSource>;

export const DEAD_LETTER_REASONS = ['unknown_code', 'contest_closed', 'malformed'] as const;
export const DeadLetterReason = z.enum(DEAD_LETTER_REASONS);
export type DeadLetterReason = z.infer<typeof DeadLetterReason>;
