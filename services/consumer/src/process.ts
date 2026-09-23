import { type DeadLetterEvent, type DeadLetterReason, VoteEvent } from '@tally/contracts';
import { acceptsVoteAt, type Db, schema } from '@tally/db';
import { inArray, sql } from 'drizzle-orm';
import type { DeadLetterPublisher } from './dead-letter-publisher.js';
import type { Resolver } from './resolver.js';
import type { ContestTotals, TotalsStore } from './totals-store.js';

export interface InboundMessage {
  topic: string;
  partition: number;
  offset: bigint;
  value: string;
}

export interface BatchResult {
  /** New votes added to totals. */
  counted: number;
  /** Already seen (same idempotency key): redelivery, replay, or a client retry. */
  duplicates: number;
  /** Written to dead_letters and published to votes.dead instead of being counted. */
  dead: number;
}

interface Deps {
  db: Db;
  resolver: Resolver;
  totals: TotalsStore;
  deadLetters: DeadLetterPublisher;
}

type NewVote = typeof schema.votes.$inferInsert;
type NewDeadLetter = typeof schema.deadLetters.$inferInsert;

/** Replay-stable identity for a message too broken to carry its own idempotency key. */
const positionKey = (m: InboundMessage) => `offset:${m.topic}/${m.partition}/${m.offset}`;

function parse(m: InboundMessage): VoteEvent | NewDeadLetter {
  let json: unknown;
  try {
    json = JSON.parse(m.value);
  } catch {
    return deadLetter({ raw: m.value }, 'malformed', positionKey(m));
  }
  const event = VoteEvent.safeParse(json);
  return event.success ? event.data : deadLetter(json, 'malformed', positionKey(m));
}

const deadLetter = (
  payload: unknown,
  reason: DeadLetterReason,
  key: string,
  contestId: string | null = null,
): NewDeadLetter => ({
  payload,
  reason,
  idempotencyKey: key,
  contestId,
});

const isDeadLetter = (x: VoteEvent | NewDeadLetter): x is NewDeadLetter => 'reason' in x;

/**
 * Idempotent: processing the same messages any number of times leaves every total unchanged.
 * Postgres is the only dedupe (unique idempotency_key); Redis receives absolute totals read back
 * from Postgres, so a crash between the commit and the Redis write heals on redelivery.
 *
 * Dead letters follow the same pattern: the rows are read back and every one in the batch is
 * published to votes.dead after the commit, so a crash before the publish heals too. The cost is
 * at-least-once on the topic: a redelivered batch republishes (same key, same failed_at).
 */
export async function processBatch(messages: InboundMessage[], deps: Deps): Promise<BatchResult> {
  /** Votes whose code resolved to an active contestant; the contest's window is checked in the transaction. */
  const candidates: { vote: NewVote; event: VoteEvent }[] = [];
  const dead: NewDeadLetter[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const m of messages) {
    const parsed = parse(m);
    if (isDeadLetter(parsed)) {
      dead.push(parsed);
      continue;
    }
    if (seen.has(parsed.idempotency_key)) {
      duplicates++;
      continue;
    }
    seen.add(parsed.idempotency_key);

    const resolved = await deps.resolver.resolve(parsed.contest_id, parsed.code);
    if (resolved.kind !== 'counted') {
      const reason = resolved.kind === 'unknown' ? 'unknown_code' : 'inactive_contestant';
      dead.push(deadLetter(parsed, reason, parsed.idempotency_key, parsed.contest_id));
      continue;
    }
    const vote: NewVote = {
      contestId: parsed.contest_id,
      contestantId: resolved.contestantId,
      codeSubmitted: parsed.code,
      voterHash: parsed.voter_hash,
      source: parsed.source,
      idempotencyKey: parsed.idempotency_key,
      // When ingest accepted the vote, not when we processed it: stable across replays.
      receivedAt: new Date(parsed.sent_at),
    };
    candidates.push({ vote, event: parsed });
  }

  const { counted, updates, deadEvents, votes } = await deps.db.transaction(async (tx) => {
    // Was each vote's contest open when ingest accepted it? The contests are read FOR SHARE, so
    // a close (setContestStatus, FOR UPDATE) waits for this batch and stamps closes_at after it:
    // every vote counted here was accepted before the stamp, and later batches see the close.
    const votes: NewVote[] = [];
    const contestIds = [...new Set(candidates.map((c) => c.event.contest_id))];
    const windows = new Map(
      contestIds.length
        ? (
            await tx
              .select({
                id: schema.contests.id,
                status: schema.contests.status,
                opensAt: schema.contests.opensAt,
                closesAt: schema.contests.closesAt,
              })
              .from(schema.contests)
              .where(inArray(schema.contests.id, contestIds))
              .for('share')
          ).map((c) => [c.id, c])
        : [],
    );
    for (const { vote, event } of candidates) {
      const contest = windows.get(event.contest_id);
      if (contest && acceptsVoteAt(contest, new Date(event.sent_at))) votes.push(vote);
      else dead.push(deadLetter(event, 'contest_closed', event.idempotency_key, event.contest_id));
    }

    const inserted = votes.length
      ? await tx
          .insert(schema.votes)
          .values(votes)
          .onConflictDoNothing({ target: schema.votes.idempotencyKey })
          .returning({ contestantId: schema.votes.contestantId })
      : [];

    const increments = new Map<string, number>();
    for (const { contestantId } of inserted) {
      if (contestantId) increments.set(contestantId, (increments.get(contestantId) ?? 0) + 1);
    }
    if (increments.size) {
      await tx
        .insert(schema.voteTotals)
        .values([...increments].map(([contestantId, total]) => ({ contestantId, total })))
        .onConflictDoUpdate({
          target: schema.voteTotals.contestantId,
          set: {
            total: sql`${schema.voteTotals.total} + excluded.total`,
            updatedAt: sql`now()`,
          },
        });
    }

    let deadEvents: DeadLetterEvent[] = [];
    if (dead.length) {
      await tx
        .insert(schema.deadLetters)
        .values(dead)
        .onConflictDoNothing({ target: schema.deadLetters.idempotencyKey });
      // Read back, not the in-memory copies: an earlier delivery may already have written the
      // row, and the topic must carry the same failed_at as the table.
      const rows = await tx
        .select()
        .from(schema.deadLetters)
        .where(
          inArray(
            schema.deadLetters.idempotencyKey,
            dead.map((d) => d.idempotencyKey as string),
          ),
        );
      deadEvents = rows.map((r) => ({
        v: 1,
        reason: r.reason,
        failed_at: r.receivedAt.toISOString(),
        idempotency_key: r.idempotencyKey as string,
        original: r.payload,
      }));
    }

    // Absolute totals for every contestant this batch touched, duplicates included: a pure
    // replay inserts nothing but must still repair Redis.
    const touched = [...new Set(votes.map((v) => v.contestantId).filter((id) => id != null))];
    return {
      counted: inserted.length,
      updates: touched.length ? await readTotals(tx, touched) : [],
      deadEvents,
      votes,
    };
  });

  // Both must succeed before the caller commits offsets; either failing means redelivery.
  await deps.deadLetters.publish(deadEvents);
  await deps.totals.apply(updates);

  return { counted, duplicates: duplicates + (votes.length - counted), dead: dead.length };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function readTotals(tx: Tx, contestantIds: string[]): Promise<ContestTotals[]> {
  const { contestants, voteTotals } = schema;
  const rows = await tx
    .select({
      contestId: contestants.contestId,
      contestantId: voteTotals.contestantId,
      total: voteTotals.total,
      contestTotal:
        sql<number>`(sum(${voteTotals.total}) over (partition by ${contestants.contestId}))::bigint`.mapWith(
          Number,
        ),
    })
    .from(voteTotals)
    .innerJoin(contestants, sql`${contestants.id} = ${voteTotals.contestantId}`)
    .where(
      inArray(
        contestants.contestId,
        tx
          .selectDistinct({ id: contestants.contestId })
          .from(contestants)
          .where(inArray(contestants.id, contestantIds)),
      ),
    );

  const byContest = new Map<string, ContestTotals>();
  const wanted = new Set(contestantIds);
  for (const r of rows) {
    const entry = byContest.get(r.contestId) ?? {
      contestId: r.contestId,
      totals: new Map<string, number>(),
      totalVotes: r.contestTotal,
    };
    if (wanted.has(r.contestantId)) entry.totals.set(r.contestantId, r.total);
    byContest.set(r.contestId, entry);
  }
  return [...byContest.values()];
}
