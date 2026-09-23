import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.ts';
import { migrate } from './migrate.ts';
import { contestants, contests, votes, voteTotals } from './schema.ts';
import { SEED_CONTEST_ID, seed } from './seed.ts';

// F2 done-when: migrations run from empty, the seed populates, re-running the seed is safe.
// Runs against a throwaway database on the local Postgres (DATABASE_URL).

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL must be set (see .env.example)');

const dbName = `tally_test_${randomBytes(4).toString('hex')}`;
const testUrl = Object.assign(new URL(adminUrl), { pathname: `/${dbName}` }).toString();

const admin = new pg.Client({ connectionString: adminUrl });
let conn: { db: Db; close: () => Promise<void> };

const counts = async () => {
  const result = await conn.db.execute<{ contests: number; contestants: number }>(sql`
    select (select count(*)::int from contests) as contests,
           (select count(*)::int from contestants) as contestants`);
  return result.rows[0];
};

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  conn = createDb(testUrl);
});

afterAll(async () => {
  await conn?.close();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('migrations and seed', () => {
  it('migrate builds every table from an empty database', async () => {
    await migrate(conn.db);

    const tables = await conn.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables where table_schema = 'public'`);
    expect(tables.rows.map((t) => t.table_name).sort()).toEqual(
      ['contestants', 'contests', 'dead_letters', 'vote_buckets', 'vote_totals', 'votes'].sort(),
    );
  });

  it('seed creates one open contest with 8–12 uniquely coded contestants', async () => {
    await seed(conn.db);

    const [contest] = await conn.db.select().from(contests);
    expect(contest?.status).toBe('open');

    const rows = await conn.db
      .select()
      .from(contestants)
      .where(eq(contestants.contestId, SEED_CONTEST_ID));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });

  it('re-running the seed changes nothing: no duplicates, no clobbered edits, votes untouched', async () => {
    const before = await counts();
    const [first] = await conn.db.select().from(contestants).limit(1);
    if (!first) throw new Error('seed produced no contestants');

    // Simulate state the seed must never touch: an admin edit, a closed contest, a counted vote.
    await conn.db
      .update(contestants)
      .set({ name: 'Edited by admin' })
      .where(eq(contestants.id, first.id));
    await conn.db
      .update(contests)
      .set({ status: 'closed' })
      .where(eq(contests.id, SEED_CONTEST_ID));
    await conn.db.insert(votes).values({
      contestId: SEED_CONTEST_ID,
      contestantId: first.id,
      codeSubmitted: first.code,
      voterHash: 'a'.repeat(64),
      source: 'generator',
      idempotencyKey: 'seed-test-vote',
    });
    await conn.db.insert(voteTotals).values({ contestantId: first.id, total: 1 });

    await seed(conn.db);

    expect(await counts()).toEqual(before);
    const [edited] = await conn.db.select().from(contestants).where(eq(contestants.id, first.id));
    expect(edited?.name).toBe('Edited by admin');
    const [contest] = await conn.db.select().from(contests).where(eq(contests.id, SEED_CONTEST_ID));
    expect(contest?.status).toBe('closed');
    const [total] = await conn.db
      .select()
      .from(voteTotals)
      .where(eq(voteTotals.contestantId, first.id));
    expect(total?.total).toBe(1);
  });

  it('migrate is safe to re-run against an up-to-date database', async () => {
    await expect(migrate(conn.db)).resolves.not.toThrow();
  });

  it('votes reject an unknown contestant (foreign key)', async () => {
    await expect(
      conn.db.insert(votes).values({
        contestId: SEED_CONTEST_ID,
        contestantId: '00000000-0000-4000-8000-000000000000',
        codeSubmitted: 'ZZ',
        voterHash: 'b'.repeat(64),
        source: 'generator',
        idempotencyKey: 'fk-test-vote',
      }),
    ).rejects.toThrow();
  });
});
