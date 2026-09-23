import { randomBytes } from 'node:crypto';
import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeadRow, RawRow } from './rows.js';
import { migrate } from './schema.js';
import { insertBatch } from './sink.js';

// Against the real ClickHouse (CLICKHOUSE_URL), in a throwaway database.

const conn = {
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'tally',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'tally',
};
const dbName = `tally_test_${randomBytes(4).toString('hex')}`;
let admin: ClickHouseClient;
let ch: ClickHouseClient;

const raw = (key: string, sentAt: string): RawRow => ({
  event_id: '0192f3a0-7c1e-7000-8000-000000000001',
  idempotency_key: key,
  contest_id: '0192f3a0-7c1e-7000-8000-00000000c0de',
  code: 'C1',
  source: 'sms',
  voter_hash: 'a'.repeat(64),
  sent_at: sentAt,
  kafka_partition: 0,
  kafka_offset: '1',
});
const q = async <T>(query: string) =>
  (await (await ch.query({ query, format: 'JSONEachRow' })).json()) as T[];

beforeAll(async () => {
  admin = createClient(conn);
  await admin.command({ query: `CREATE DATABASE ${dbName}` });
  ch = createClient({ ...conn, database: dbName });
  await migrate(ch);
  await migrate(ch); // startup runs it every time: a second run must be a no-op
});
afterAll(async () => {
  await admin?.command({ query: `DROP DATABASE IF EXISTS ${dbName}` });
  await ch?.close();
  await admin?.close();
});

describe('insertBatch', () => {
  it('stores votes with millisecond timestamps, and redeliveries as extra rows that dedupe by key', async () => {
    const batch = [raw('k1', '2026-09-24T10:00:00.123Z'), raw('k2', '2026-09-24T10:00:59.999Z')];
    await insertBatch(ch, batch, []);
    await insertBatch(ch, batch, []); // redelivered batch
    // 64-bit counts come back as numbers or strings depending on server settings.
    const [counts] = await q<{ rows: number | string; votes: number | string }>(
      'SELECT count() AS rows, uniqExact(idempotency_key) AS votes FROM votes_raw',
    );
    expect([Number(counts?.rows), Number(counts?.votes)]).toEqual([4, 2]);
    const minutes = await q<{ minute: string; n: number | string }>(
      `SELECT toStartOfMinute(sent_at) AS minute, uniqExact(idempotency_key) AS n FROM votes_raw GROUP BY minute ORDER BY minute`,
    );
    expect(minutes.map((m) => [m.minute, Number(m.n)])).toEqual([['2026-09-24 10:00:00', 2]]);
    const [first] = await q<{ t: string }>(
      `SELECT toString(sent_at) AS t FROM votes_raw WHERE idempotency_key = 'k1' LIMIT 1`,
    );
    expect(first?.t).toBe('2026-09-24 10:00:00.123');
  });

  it('stores dead letters, including malformed ones with no contest', async () => {
    const dead: DeadRow = {
      idempotency_key: 'offset:votes.raw/0/9',
      reason: 'malformed',
      contest_id: null,
      code: null,
      failed_at: '2026-09-24T10:00:01.000Z',
      original: '{"raw":"not json"}',
      kafka_partition: 0,
      kafka_offset: '3',
    };
    await insertBatch(ch, [], [dead]);
    expect(await q('SELECT reason, contest_id, original FROM votes_dead')).toEqual([
      { reason: 'malformed', contest_id: null, original: '{"raw":"not json"}' },
    ]);
  });

  it("per-minute counts: distinct votes, rejections filed under their vote's minute, redelivery-proof", async () => {
    await ch.command({ query: 'TRUNCATE TABLE votes_raw' });
    await ch.command({ query: 'TRUNCATE TABLE votes_dead' });
    const minuteA = '2026-09-24T11:00:10.000Z';
    const minuteB = '2026-09-24T11:01:10.000Z';
    const votes = [raw('a1', minuteA), raw('a2', minuteA), raw('b1', minuteB)];
    await insertBatch(ch, votes, []);
    await insertBatch(ch, votes, []); // redelivery
    // a2 was rejected (contest closed) a minute later than it was accepted.
    const rejected: DeadRow = {
      idempotency_key: 'a2',
      reason: 'contest_closed',
      contest_id: '0192f3a0-7c1e-7000-8000-00000000c0de',
      code: 'C1',
      failed_at: '2026-09-24T11:02:00.000Z',
      original: JSON.stringify({ sent_at: minuteA, code: 'C1' }),
      kafka_partition: 0,
      kafka_offset: '4',
    };
    await insertBatch(ch, [], [rejected, rejected]);

    const perMinute = await q<{
      minute: string;
      accepted: number | string;
      rejected: number | string;
    }>(`
      SELECT minute, accepted, rejected FROM
        (SELECT toStartOfMinute(sent_at) AS minute, uniqExact(key_hash) AS accepted FROM votes_raw GROUP BY minute) AS a
      LEFT JOIN
        (SELECT toStartOfMinute(sent_at) AS minute, uniqExact(key_hash) AS rejected FROM votes_dead GROUP BY minute) AS d
      USING minute ORDER BY minute`);
    expect(perMinute.map((r) => [r.minute, Number(r.accepted), Number(r.rejected)])).toEqual([
      ['2026-09-24 11:00:00', 2, 1],
      ['2026-09-24 11:01:00', 1, 0],
    ]);
  });
});
