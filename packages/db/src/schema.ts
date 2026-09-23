import { CONTEST_STATUSES, DEAD_LETTER_REASONS, VOTE_SOURCES } from '@tally/contracts';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const contestStatus = pgEnum('contest_status', CONTEST_STATUSES);
export const voteSource = pgEnum('vote_source', VOTE_SOURCES);
export const deadLetterReason = pgEnum('dead_letter_reason', DEAD_LETTER_REASONS);

export const contests = pgTable('contests', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: contestStatus('status').notNull().default('draft'),
  opensAt: timestamptz('opens_at'),
  closesAt: timestamptz('closes_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const contestants = pgTable(
  'contestants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contests.id),
    name: text('name').notNull(),
    /** What voters send. Unique per contest. */
    code: text('code').notNull(),
    imageUrl: text('image_url'),
    accentFrom: text('accent_from'),
    accentTo: text('accent_to'),
    /** ISO 3166-1 alpha-2. */
    countryCode: text('country_code'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('contestants_contest_code_unique').on(t.contestId, t.code)],
);

/** Append-only vote log. Postgres truth: Redis totals must be rebuildable from this table. */
export const votes = pgTable(
  'votes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contests.id),
    /** Null means unresolved. */
    contestantId: uuid('contestant_id').references(() => contestants.id),
    codeSubmitted: text('code_submitted').notNull(),
    /** SHA-256 of sender identifier + salt. Never a raw identifier. */
    voterHash: text('voter_hash').notNull(),
    source: voteSource('source').notNull(),
    /** Guards against queue redelivery. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [index('votes_contest_received_idx').on(t.contestId, t.receivedAt)],
);

export const voteTotals = pgTable('vote_totals', {
  contestantId: uuid('contestant_id')
    .primaryKey()
    .references(() => contestants.id),
  total: bigint('total', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const voteBuckets = pgTable(
  'vote_buckets',
  {
    contestantId: uuid('contestant_id')
      .notNull()
      .references(() => contestants.id),
    /** Truncated to the minute. */
    bucketMinute: timestamptz('bucket_minute').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.contestantId, t.bucketMinute] })],
);

/** Mirrors the votes.dead topic for the admin view. */
export const deadLetters = pgTable('dead_letters', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /**
   * Replay guard: the vote's idempotency key, or `topic/partition/offset` for a message too
   * malformed to have one. Unique, so reprocessing the log never duplicates a dead letter.
   */
  idempotencyKey: text('idempotency_key').unique(),
  payload: jsonb('payload').notNull(),
  reason: deadLetterReason('reason').notNull(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
});
