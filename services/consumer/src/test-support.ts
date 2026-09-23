import { randomBytes, randomUUID } from 'node:crypto';
import type { VoteEvent } from '@tally/contracts';
import { createDb, migrate, SEED_CONTEST_ID, seed } from '@tally/db';
import { Redis } from 'ioredis';
import pg from 'pg';

// Shared by the consumer's integration tests: a throwaway Postgres database (migrated and
// seeded) and an isolated Redis logical database, so dev data is never touched.

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example)`);
  return value;
};

/** Redis logical DB reserved for tests; flushed before and after each suite. */
const TEST_REDIS_DB = 15;

export async function createTestStores() {
  const adminUrl = need('DATABASE_URL');
  const name = `tally_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);

  const url = Object.assign(new URL(adminUrl), { pathname: `/${name}` }).toString();
  const conn = createDb(url);
  await migrate(conn.db);
  await seed(conn.db);

  const redisUrl = Object.assign(new URL(need('REDIS_URL')), {
    pathname: `/${TEST_REDIS_DB}`,
  }).toString();
  const redis = new Redis(redisUrl);
  await redis.flushdb();

  return {
    db: conn.db,
    redis,
    redisUrl,
    databaseUrl: url,
    async cleanup() {
      await redis.flushdb();
      redis.disconnect();
      await conn.close();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

export const CONTEST_ID = SEED_CONTEST_ID;
export const CODES = Array.from({ length: 10 }, (_, i) => `C${i + 1}`);

export const voteEvent = (code: string, overrides: Partial<VoteEvent> = {}): VoteEvent => ({
  v: 1,
  event_id: randomUUID(),
  contest_id: CONTEST_ID,
  code,
  voter_hash: randomBytes(32).toString('hex'),
  source: 'generator',
  sent_at: new Date().toISOString(),
  idempotency_key: randomUUID(),
  ...overrides,
});
