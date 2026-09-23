import type { ClickHouseClient } from '@clickhouse/client';

/**
 * The analytics tables, created at startup if missing (idempotent). Analytics is derived and
 * rebuildable: resetting the consumer group's offsets replays the topics into fresh tables.
 *
 * Rows are stored as delivered. Delivery is at-least-once and a retried POST can reach the
 * topic twice with one idempotency key, so readers count distinct `idempotency_key`s (F21).
 */
export const SCHEMA = [
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
];

export async function ensureSchema(ch: ClickHouseClient) {
  for (const query of SCHEMA) await ch.command({ query });
}
