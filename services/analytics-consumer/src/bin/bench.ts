import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@clickhouse/client';
import { migrate } from '../schema.js';

// F21: `pnpm bench:clickhouse [votes]` builds a throwaway database with the production schema,
// fills it with synthetic votes (default 10M for the contest under test, as many again for a
// second contest, 5% of them rejected), then times the analytics page's per-minute queries,
// straight from the vote table and from the rollups. Report: load-results/clickhouse-<ts>.md.

const N = Number(process.argv[2] ?? 10_000_000);
const HOURS = 3;
const DB = 'tally_bench';
const TARGET = '00000000-0000-4000-8000-00000000be01';
const OTHER = '00000000-0000-4000-8000-00000000be02';
const base = {
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'tally',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'tally',
};

const admin = createClient(base);
await admin.command({ query: `DROP DATABASE IF EXISTS ${DB}` });
await admin.command({ query: `CREATE DATABASE ${DB}` });
const ch = createClient({ ...base, database: DB, request_timeout: 600_000 });
await migrate(ch);

// --- synthetic data ---------------------------------------------------------------------------
const spanMs = HOURS * 3600 * 1000;
const start = Date.UTC(2026, 8, 24, 18, 0);
const votesFor = (contest: string, salt: string) => `
  INSERT INTO votes_raw (event_id, idempotency_key, contest_id, code, source, voter_hash, sent_at, kafka_partition, kafka_offset)
  SELECT generateUUIDv4(number), concat('${salt}-', toString(number)), '${contest}',
         concat('C', toString(1 + (cityHash64(number) % 10))),
         ['sms', 'sms', 'sms', 'web', 'generator'][1 + (number % 5)],
         lower(hex(MD5(toString(number)))),
         fromUnixTimestamp64Milli(toInt64(${start} + intDiv(number * ${spanMs}, ${N}))),
         number % 6, number
  FROM numbers(${N})`;
const t0 = Date.now();
await ch.command({
  query: votesFor(TARGET, 't'),
  clickhouse_settings: { max_insert_threads: '4' },
});
await ch.command({ query: votesFor(OTHER, 'o'), clickhouse_settings: { max_insert_threads: '4' } });
// 5% of the contest's votes rejected, each filed under its vote's minute.
await ch.command({
  query: `
  INSERT INTO votes_dead (idempotency_key, reason, contest_id, code, failed_at, original, kafka_partition, kafka_offset)
  SELECT idempotency_key, ['unknown_code', 'contest_closed', 'inactive_contestant'][1 + (cityHash64(idempotency_key) % 3)],
         contest_id, code, sent_at + 1,
         concat('{"sent_at":"', formatDateTime(sent_at, '%Y-%m-%dT%H:%i:%S.%fZ'), '","code":"', code, '"}'), 0, 0
  FROM votes_raw WHERE contest_id = '${TARGET}' AND cityHash64(idempotency_key) % 20 = 0`,
});
const loadSeconds = (Date.now() - t0) / 1000;

const sizes = (await (
  await ch.query({
    query: `SELECT table, sum(rows) AS rows, formatReadableSize(sum(data_compressed_bytes)) AS size
          FROM system.parts WHERE database = '${DB}' AND active GROUP BY table ORDER BY table`,
    format: 'JSONEachRow',
  })
).json()) as { table: string; rows: string; size: string }[];

// --- queries ----------------------------------------------------------------------------------
const lastHalfHour = `fromUnixTimestamp64Milli(toInt64(${start + spanMs - 30 * 60_000}))`;
const QUERIES: { name: string; sql: string }[] = [
  {
    name: 'Votes per minute, whole contest: count() (duplicates counted)',
    sql: `SELECT toStartOfMinute(sent_at) AS minute, count() AS votes
          FROM votes_raw WHERE contest_id = '${TARGET}' GROUP BY minute ORDER BY minute`,
  },
  {
    name: 'Votes per minute, whole contest: distinct keys (strings)',
    sql: `SELECT toStartOfMinute(sent_at) AS minute, uniqExact(idempotency_key) AS votes
          FROM votes_raw WHERE contest_id = '${TARGET}' GROUP BY minute ORDER BY minute`,
  },
  {
    name: 'Votes per minute, whole contest: distinct key hashes',
    sql: `SELECT toStartOfMinute(sent_at) AS minute, uniqExact(key_hash) AS votes
          FROM votes_raw WHERE contest_id = '${TARGET}' GROUP BY minute ORDER BY minute`,
  },
  {
    name: 'Counted per minute (accepted − rejected), key hashes',
    sql: `SELECT minute, accepted - rejected AS counted FROM
            (SELECT toStartOfMinute(sent_at) AS minute, uniqExact(key_hash) AS accepted
             FROM votes_raw WHERE contest_id = '${TARGET}' GROUP BY minute) AS a
          LEFT JOIN
            (SELECT toStartOfMinute(sent_at) AS minute, uniqExact(key_hash) AS rejected
             FROM votes_dead WHERE contest_id = '${TARGET}' GROUP BY minute) AS d USING minute
          ORDER BY minute`,
  },
  {
    name: 'Per minute per contestant (lead changes), key hashes',
    sql: `SELECT toStartOfMinute(sent_at) AS minute, code, uniqExact(key_hash) AS votes
          FROM votes_raw WHERE contest_id = '${TARGET}' GROUP BY minute, code ORDER BY minute, code`,
  },
  {
    name: 'By source, whole contest, key hashes',
    sql: `SELECT source, uniqExact(key_hash) AS votes FROM votes_raw
          WHERE contest_id = '${TARGET}' GROUP BY source ORDER BY votes DESC`,
  },
  {
    name: 'Votes per minute, last 30 minutes, key hashes',
    sql: `SELECT toStartOfMinute(sent_at) AS minute, uniqExact(key_hash) AS votes
          FROM votes_raw WHERE contest_id = '${TARGET}' AND sent_at >= ${lastHalfHour}
          GROUP BY minute ORDER BY minute`,
  },
];

interface Timing {
  name: string;
  ms: number;
  rows: number;
  readRows: number;
  readMB: number;
}
const results: Timing[] = [];
for (const q of QUERIES) {
  const runs: { ms: number; readRows: number; readBytes: number; rows: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await ch.query({
      query: q.sql,
      format: 'JSONEachRow',
      clickhouse_settings: { use_query_cache: 0 },
    });
    const rows = ((await res.json()) as unknown[]).length;
    const summary = JSON.parse(res.response_headers['x-clickhouse-summary'] as string);
    runs.push({
      ms: Number(summary.elapsed_ns) / 1e6,
      readRows: Number(summary.read_rows),
      readBytes: Number(summary.read_bytes),
      rows,
    });
  }
  const warm = runs.slice(1).sort((a, b) => a.ms - b.ms); // first run warms caches; median of the rest
  const mid = warm[Math.floor(warm.length / 2)] ?? runs[0];
  if (!mid) continue;
  results.push({
    name: q.name,
    ms: mid.ms,
    rows: mid.rows,
    readRows: mid.readRows,
    readMB: mid.readBytes / 2 ** 20,
  });
}

const n = (x: number, d = 0) =>
  x.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const report = `# ClickHouse per-minute queries: ${n(N)} votes per contest

- **Data:** ${n(N)} synthetic votes for the contest under test over ${HOURS} h (${n(N / HOURS / 3600, 0)} votes/s average), ${n(N)} more for a second contest, 5% of the first contest's votes rejected. Loaded in ${n(loadSeconds, 1)} s.
- **Server:** ClickHouse ${(await (await ch.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' })).json<{ v: string }>())[0]?.v} in Docker on ${os.cpus()[0]?.model.replace(/\s+/g, ' ')}, ${os.cpus().length} threads, shared with the rest of the stack.
- **Timing:** server-side elapsed from \`X-ClickHouse-Summary\`, median of 5 runs after a warm-up, query cache off.

| Query | Time | Rows returned | Rows read | Data read |
|---|---|---|---|---|
${results.map((r) => `| ${r.name} | **${n(r.ms, 1)} ms** | ${n(r.rows)} | ${n(r.readRows)} | ${n(r.readMB, 1)} MB |`).join('\n')}

Table sizes:

| Table | Rows | Compressed |
|---|---|---|
${sizes.map((s) => `| \`${s.table}\` | ${n(Number(s.rows))} | ${s.size} |`).join('\n')}

Reproduce: \`docker compose up -d clickhouse\`, then \`pnpm bench:clickhouse\` (optionally a vote count: \`pnpm bench:clickhouse 20000000\`).
`;
const outDir = path.join(import.meta.dirname, '../../../../load-results');
mkdirSync(outDir, { recursive: true });
const file = path.join(
  outDir,
  `clickhouse-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}.md`,
);
writeFileSync(file, report);
console.log(report);
console.log(`report: ${path.relative(process.cwd(), file)}`);

if (!process.argv.includes('--keep')) await admin.command({ query: `DROP DATABASE ${DB}` });
await ch.close();
await admin.close();
