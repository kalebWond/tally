import type { ClickHouseClient } from '@clickhouse/client';

/**
 * ClickHouse schema, as ordered migrations recorded in `_migrations` and applied at startup.
 * Analytics is derived data: resetting the consumer group's offsets replays the topics into it.
 *
 * Rows arrive as delivered (at-least-once, and a client retry reaches the topic twice with one
 * idempotency key), so everything that counts votes counts distinct `idempotency_key`s.
 */
export const MIGRATIONS: { id: string; statements: string[] }[] = [
  {
    id: '001_events',
    statements: [
      // Every vote ingest accepted. Sorted for the questions analytics asks: one contest, a time
      // range. contest_id first prunes to one contest; sent_at next makes time ranges and
      // per-minute grouping read contiguous granules.
      `CREATE TABLE IF NOT EXISTS votes_raw (
        event_id         UUID,
        idempotency_key  String,
        contest_id       UUID,
        code             LowCardinality(String),
        source           LowCardinality(String),
        voter_hash       String,
        sent_at          DateTime64(3, 'UTC'),
        kafka_partition  UInt8,
        kafka_offset     UInt64,
        inserted_at      DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(sent_at)
      ORDER BY (contest_id, sent_at, idempotency_key)`,
      // Every dead letter, with its reason.
      `CREATE TABLE IF NOT EXISTS votes_dead (
        idempotency_key  String,
        reason           LowCardinality(String),
        contest_id       Nullable(UUID),
        code             Nullable(String),
        failed_at        DateTime64(3, 'UTC'),
        original         String,
        kafka_partition  UInt8,
        kafka_offset     UInt64,
        inserted_at      DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(failed_at)
      ORDER BY (failed_at, idempotency_key)`,
    ],
  },
  {
    id: '002_scan_columns',
    statements: [
      // A rejection belongs to the minute its vote was accepted, like the vote itself, so
      // "counted = accepted − rejected" lines up minute by minute. Derived from the original
      // on insert; existing rows get it by MATERIALIZE.
      `ALTER TABLE votes_dead ADD COLUMN IF NOT EXISTS sent_at DateTime64(3, 'UTC')
        DEFAULT parseDateTime64BestEffortOrZero(JSONExtractString(original, 'sent_at'), 3)
        AFTER failed_at`,
      `ALTER TABLE votes_dead MATERIALIZE COLUMN sent_at`,
      // Compression for the columns that dominate the table: timestamps that barely move.
      `ALTER TABLE votes_raw MODIFY COLUMN sent_at DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))`,
      `ALTER TABLE votes_raw MODIFY COLUMN inserted_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1))`,

      // Distinct votes are counted over a 64-bit hash of the idempotency key: hashing a set of
      // integers is several times cheaper than a set of strings, and a collision among even
      // 100M keys has odds around 1 in 3,700 (birthday bound), far below what a chart can show.
      `ALTER TABLE votes_raw ADD COLUMN IF NOT EXISTS key_hash UInt64 MATERIALIZED cityHash64(idempotency_key)`,
      `ALTER TABLE votes_raw MATERIALIZE COLUMN key_hash`,
      `ALTER TABLE votes_dead ADD COLUMN IF NOT EXISTS key_hash UInt64 MATERIALIZED cityHash64(idempotency_key)`,
      `ALTER TABLE votes_dead MATERIALIZE COLUMN key_hash`,
    ],
  },
];

/**
 * Applies the migrations not yet recorded, in order. One analytics consumer runs at a time, so
 * there's no locking; a migration that fails part-way is re-run whole next start, and every
 * statement is written to be safe to repeat.
 */
export async function migrate(
  ch: ClickHouseClient,
  log?: { info: (o: object, m: string) => void },
) {
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS _migrations (id String, applied_at DateTime DEFAULT now())
            ENGINE = MergeTree ORDER BY id`,
  });
  const applied = new Set(
    (
      (await (
        await ch.query({ query: 'SELECT id FROM _migrations', format: 'JSONEachRow' })
      ).json()) as { id: string }[]
    ).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const started = Date.now();
    for (const query of m.statements) {
      await ch.command({ query, clickhouse_settings: { mutations_sync: '2' } });
    }
    await ch.insert({ table: '_migrations', values: [{ id: m.id }], format: 'JSONEachRow' });
    log?.info({ migration: m.id, ms: Date.now() - started }, 'clickhouse migration applied');
  }
}
