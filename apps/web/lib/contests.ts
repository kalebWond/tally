import 'server-only';
import { schema } from '@tally/db';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import type { Entrant } from './standings';

export async function getContest(id: string) {
  const [contest] = await db()
    .select({ id: schema.contests.id, name: schema.contests.name, status: schema.contests.status })
    .from(schema.contests)
    .where(eq(schema.contests.id, id))
    .limit(1);
  return contest;
}

export async function getEntrants(contestId: string): Promise<Entrant[]> {
  const c = schema.contestants;
  return db()
    .select({
      id: c.id,
      code: c.code,
      name: c.name,
      imageUrl: c.imageUrl,
      accentFrom: c.accentFrom,
      accentTo: c.accentTo,
      countryCode: c.countryCode,
    })
    .from(c)
    .where(eq(c.contestId, contestId))
    .orderBy(asc(c.code));
}

/** Every contest, open ones first, for pickers. */
export async function getContests() {
  const c = schema.contests;
  return db()
    .select({ id: c.id, name: c.name, status: c.status })
    .from(c)
    .orderBy(sql`${c.status} = 'open' desc`, desc(c.createdAt));
}

/** The contest `/` should show: the most recently opened open contest, else the newest one. */
export async function getCurrentContestId() {
  const c = schema.contests;
  const [row] = await db()
    .select({ id: c.id })
    .from(c)
    .orderBy(sql`${c.status} = 'open' desc`, desc(sql`coalesce(${c.opensAt}, ${c.createdAt})`))
    .limit(1);
  return row?.id;
}
