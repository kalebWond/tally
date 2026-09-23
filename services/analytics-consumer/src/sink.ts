import type { ClickHouseClient } from '@clickhouse/client';
import type { DeadRow, RawRow } from './rows.js';

/** Inserts one batch; both tables or an error (the caller retries the whole batch). */
export async function insertBatch(ch: ClickHouseClient, raw: RawRow[], dead: DeadRow[]) {
  const settings = { date_time_input_format: 'best_effort' } as const;
  await Promise.all([
    raw.length
      ? ch.insert({
          table: 'votes_raw',
          values: raw,
          format: 'JSONEachRow',
          clickhouse_settings: settings,
        })
      : null,
    dead.length
      ? ch.insert({
          table: 'votes_dead',
          values: dead,
          format: 'JSONEachRow',
          clickhouse_settings: settings,
        })
      : null,
  ]);
}
