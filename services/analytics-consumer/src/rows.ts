import { DeadLetterEvent, TOPICS, VoteEvent } from '@tally/contracts';

/** A row of `votes_raw`: every vote ingest accepted, as it was on votes.raw. */
export interface RawRow {
  event_id: string;
  idempotency_key: string;
  contest_id: string;
  code: string;
  source: string;
  voter_hash: string;
  /** When ingest accepted it (ISO); the same instant Postgres files the vote under. */
  sent_at: string;
  kafka_partition: number;
  kafka_offset: string;
}

/** A row of `votes_dead`: every dead letter on votes.dead, with the reason. */
export interface DeadRow {
  idempotency_key: string;
  reason: string;
  contest_id: string | null;
  code: string | null;
  failed_at: string;
  /** The message as received, as JSON text. */
  original: string;
  kafka_partition: number;
  kafka_offset: string;
}

export interface InboundMessage {
  topic: string;
  partition: number;
  offset: bigint;
  value: string;
}

export type Mapped =
  | { table: 'votes_raw'; row: RawRow }
  | { table: 'votes_dead'; row: DeadRow }
  /** Unparseable: nothing to record here. A malformed vote is on votes.dead too, as `malformed`. */
  | { table: null; reason: string };

const parse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

/** Maps one message from either topic to its ClickHouse row. Pure, so it's unit-tested. */
export function toRow(m: InboundMessage): Mapped {
  const json = parse(m.value);
  const position = { kafka_partition: m.partition, kafka_offset: m.offset.toString() };
  if (m.topic === TOPICS.raw) {
    const vote = VoteEvent.safeParse(json);
    if (!vote.success)
      return { table: null, reason: 'malformed vote (dead-lettered by the totals consumer)' };
    const v = vote.data;
    return {
      table: 'votes_raw',
      row: {
        event_id: v.event_id,
        idempotency_key: v.idempotency_key,
        contest_id: v.contest_id,
        code: v.code,
        source: v.source,
        voter_hash: v.voter_hash,
        sent_at: v.sent_at,
        ...position,
      },
    };
  }
  if (m.topic === TOPICS.dead) {
    const dead = DeadLetterEvent.safeParse(json);
    if (!dead.success) return { table: null, reason: 'unreadable dead letter' };
    const d = dead.data;
    const original =
      d.original && typeof d.original === 'object' ? (d.original as Record<string, unknown>) : {};
    const str = (k: string) => (typeof original[k] === 'string' ? (original[k] as string) : null);
    const contest = str('contest_id');
    return {
      table: 'votes_dead',
      row: {
        idempotency_key: d.idempotency_key,
        reason: d.reason,
        contest_id: contest && /^[0-9a-f-]{36}$/i.test(contest) ? contest : null,
        code: str('code'),
        failed_at: d.failed_at,
        original: JSON.stringify(d.original),
        ...position,
      },
    };
  }
  return { table: null, reason: `unexpected topic ${m.topic}` };
}
