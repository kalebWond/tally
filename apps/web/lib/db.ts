import 'server-only';
import { createDb, type Db } from '@tally/db';
import { serverEnv } from './server-env';

// One pool per server process. Dev hot reloads re-evaluate modules, so keep it on globalThis.
const cache = globalThis as unknown as { tallyDb?: Db };

export function db(): Db {
  // Fail fast when Postgres is down: pages that can do without it (analytics labels) move on.
  cache.tallyDb ??= createDb(serverEnv().DATABASE_URL, { connectionTimeoutMillis: 2000 }).db;
  return cache.tallyDb;
}
