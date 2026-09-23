import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb } from './client.ts';
import { migrate } from './migrate.ts';
import { seed } from './seed.ts';

/**
 * For integration tests: a throwaway database on the Postgres at DATABASE_URL, migrated and
 * seeded, dropped by `cleanup`. Dev data is never touched. Test-only; not part of the main entry.
 */
export async function createTestDatabase() {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL must be set (see .env.example)');
  const name = `tally_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);

  const conn = createDb(Object.assign(new URL(adminUrl), { pathname: `/${name}` }).toString());
  await migrate(conn.db);
  await seed(conn.db);
  return {
    db: conn.db,
    async cleanup() {
      await conn.close();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
