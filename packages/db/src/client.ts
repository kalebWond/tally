import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

/** `connectionTimeoutMillis`: how long to wait for a connection before failing (default: forever). */
export function createDb(
  connectionString: string,
  opts: { connectionTimeoutMillis?: number } = {},
) {
  const pool = new pg.Pool({ connectionString, ...opts });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
