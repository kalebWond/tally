import 'server-only';
import { type ClickHouseClient, createClient } from '@clickhouse/client';
import {
  bucketMinutes,
  cumulative,
  type LeadChange,
  leadChanges,
  type MinuteCount,
} from './lead-changes';
import { clickhouseEnv } from './server-env';

// Analytics page data (F22). ClickHouse only: nothing here touches Postgres, so the analytics
// page keeps working while the operational database is busy, or down.
//
// "Counted" = distinct accepted votes (votes_raw) whose key isn't among the contest's dead
// letters: the same result the totals consumer reaches, computed independently (F21 checked
// it minute for minute against Postgres).

const cache = globalThis as unknown as { tallyClickhouse?: ClickHouseClient };
function clickhouse() {
  const env = clickhouseEnv();
  cache.tallyClickhouse ??= createClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DB,
    request_timeout: 15_000,
  });
  return cache.tallyClickhouse;
}

async function rows<T>(query: string, params: Record<string, unknown>) {
  const res = await clickhouse().query({ query, query_params: params, format: 'JSONEachRow' });
  return res.json<T>();
}

const COUNTED = `
  votes_raw
  WHERE contest_id = {contest:UUID}
    AND key_hash NOT IN (SELECT key_hash FROM votes_dead WHERE contest_id = {contest:UUID})`;

/** The contest with the latest votes: the page's default when Postgres can't say which is current. */
export async function latestContestId(): Promise<string | undefined> {
  const [row] = await rows<{ id: string }>(
    'SELECT contest_id AS id FROM votes_raw ORDER BY sent_at DESC LIMIT 1',
    {},
  );
  return row?.id;
}

export interface Analytics {
  contestId: string;
  counted: number;
  rejected: number;
  bucketMinutes: number;
  /** Per bucket: counted and rejected votes. */
  turnout: { bucket: number; counted: number; rejected: number }[];
  bySource: { source: string; votes: number }[];
  byReason: { reason: string; votes: number }[];
  /** Cumulative counted votes per code at each minute with votes (for the history chart). */
  history: { minute: number; totals: Record<string, number> }[];
  leadChanges: LeadChange[];
  /** How long ClickHouse took, for the page's footer. */
  queryMs: number;
}

export async function contestAnalytics(contestId: string): Promise<Analytics> {
  const started = performance.now();
  const p = { contest: contestId };
  const [[span], perCode, bySource, byReason] = await Promise.all([
    rows<{ from: number; to: number }>(
      `SELECT toUnixTimestamp(min(sent_at)) * 1000 AS from, toUnixTimestamp(max(sent_at)) * 1000 AS to
       FROM votes_raw WHERE contest_id = {contest:UUID}`,
      p,
    ),
    rows<{ minute: number; code: string; votes: number }>(
      `SELECT toUnixTimestamp(toStartOfMinute(sent_at)) * 1000 AS minute, code, uniqExact(key_hash) AS votes
       FROM ${COUNTED} GROUP BY minute, code ORDER BY minute`,
      p,
    ),
    rows<{ source: string; votes: number }>(
      `SELECT source, uniqExact(key_hash) AS votes FROM ${COUNTED} GROUP BY source ORDER BY votes DESC`,
      p,
    ),
    rows<{ reason: string; votes: number }>(
      `SELECT reason, uniqExact(key_hash) AS votes FROM votes_dead
       WHERE contest_id = {contest:UUID} GROUP BY reason ORDER BY votes DESC`,
      p,
    ),
  ]);

  const spanMinutes = span?.from && span.to ? (Number(span.to) - Number(span.from)) / 60_000 : 0;
  const size = bucketMinutes(spanMinutes);
  const turnout = await rows<{ bucket: number; counted: number; rejected: number }>(
    `SELECT bucket, sum(counted) AS counted, sum(rejected) AS rejected FROM (
       SELECT toUnixTimestamp(toStartOfInterval(sent_at, INTERVAL {size:UInt32} MINUTE)) * 1000 AS bucket,
              uniqExact(key_hash) AS counted, 0 AS rejected
       FROM ${COUNTED} GROUP BY bucket
       UNION ALL
       SELECT toUnixTimestamp(toStartOfInterval(sent_at, INTERVAL {size:UInt32} MINUTE)) * 1000 AS bucket,
              0 AS counted, uniqExact(key_hash) AS rejected
       FROM votes_dead WHERE contest_id = {contest:UUID} GROUP BY bucket
     ) GROUP BY bucket ORDER BY bucket`,
    { ...p, size },
  );

  const counts: MinuteCount[] = perCode.map((r) => ({
    minute: Number(r.minute),
    code: r.code,
    votes: Number(r.votes),
  }));
  const num = <T extends Record<string, unknown>>(xs: T[], k: keyof T) =>
    xs.reduce((s, x) => s + Number(x[k]), 0);
  return {
    contestId,
    counted: counts.reduce((s, c) => s + c.votes, 0),
    rejected: num(byReason, 'votes'),
    bucketMinutes: size,
    turnout: turnout.map((t) => ({
      bucket: Number(t.bucket),
      counted: Number(t.counted),
      rejected: Number(t.rejected),
    })),
    bySource: bySource.map((s) => ({ source: s.source, votes: Number(s.votes) })),
    byReason: byReason.map((r) => ({ reason: r.reason, votes: Number(r.votes) })),
    history: cumulative(counts),
    leadChanges: leadChanges(counts),
    queryMs: Math.round(performance.now() - started),
  };
}
