import { TOPICS } from '@tally/contracts';
import { describe, expect, it } from 'vitest';
import { toRow } from './rows.js';

const vote = {
  v: 1,
  event_id: '0192f3a0-7c1e-7000-8000-000000000001',
  contest_id: '0192f3a0-7c1e-7000-8000-00000000c0de',
  code: 'C3',
  voter_hash: 'a'.repeat(64),
  source: 'sms',
  sent_at: '2026-09-24T10:00:00.123Z',
  idempotency_key: 'k1',
};
const msg = (topic: string, value: unknown, offset = 7n) => ({
  topic,
  partition: 2,
  offset,
  value: typeof value === 'string' ? value : JSON.stringify(value),
});

describe('toRow', () => {
  it('maps a vote to votes_raw, keeping when ingest accepted it and where it sat on the topic', () => {
    expect(toRow(msg(TOPICS.raw, vote))).toEqual({
      table: 'votes_raw',
      row: {
        event_id: vote.event_id,
        idempotency_key: 'k1',
        contest_id: vote.contest_id,
        code: 'C3',
        source: 'sms',
        voter_hash: vote.voter_hash,
        sent_at: vote.sent_at,
        kafka_partition: 2,
        kafka_offset: '7',
      },
    });
  });

  it('maps a dead letter with its reason, pulling contest and code out of the original', () => {
    const dead = {
      v: 1,
      reason: 'unknown_code',
      failed_at: '2026-09-24T10:00:01.000Z',
      idempotency_key: 'k2',
      original: { ...vote, code: 'XQ' },
    };
    expect(toRow(msg(TOPICS.dead, dead))).toMatchObject({
      table: 'votes_dead',
      row: {
        idempotency_key: 'k2',
        reason: 'unknown_code',
        contest_id: vote.contest_id,
        code: 'XQ',
      },
    });
  });

  it('keeps a malformed dead letter, with no contest or code to pull out', () => {
    const dead = {
      v: 1,
      reason: 'malformed',
      failed_at: '2026-09-24T10:00:01.000Z',
      idempotency_key: 'offset:votes.raw/0/9',
      original: { raw: 'not json' },
    };
    expect(toRow(msg(TOPICS.dead, dead))).toMatchObject({
      table: 'votes_dead',
      row: { reason: 'malformed', contest_id: null, code: null, original: '{"raw":"not json"}' },
    });
  });

  it('skips an unparseable vote: it reaches votes.dead as malformed anyway', () => {
    expect(toRow(msg(TOPICS.raw, 'not json'))).toMatchObject({ table: null });
    expect(toRow(msg(TOPICS.raw, { hello: 1 }))).toMatchObject({ table: null });
  });
});
