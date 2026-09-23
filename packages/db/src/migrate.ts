import path from 'node:path';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

// src/ and dist/ sit at the same depth, so this resolves in dev and in built output.
// The container image sets MIGRATIONS_DIR because it doesn't keep the repo layout.
const defaultDir = path.resolve(import.meta.dirname, '../../../infra/migrations');

export function migrate(db: Db, migrationsFolder = process.env.MIGRATIONS_DIR ?? defaultDir) {
  return runMigrations(db, { migrationsFolder });
}
