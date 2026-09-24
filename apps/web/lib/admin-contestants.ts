import 'server-only';
import type {
  Contestant,
  ContestantCreate,
  ContestantUpdate,
  ErrorResponse,
} from '@tally/contracts';
import { pgCode, schema } from '@tally/db';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';

const c = schema.contestants;
const columns = {
  id: c.id,
  contestId: c.contestId,
  code: c.code,
  name: c.name,
  imageUrl: c.imageUrl,
  accentFrom: c.accentFrom,
  accentTo: c.accentTo,
  countryCode: c.countryCode,
  active: c.active,
};

export type AdminContestant = Contestant & { votes: number };

const byCode = new Intl.Collator('en', { numeric: true }).compare;

/** Every contestant in a contest, inactive ones included, with its vote count. Natural code order (C2 before C10). */
export async function listContestants(contestId: string): Promise<AdminContestant[]> {
  const rows = await db()
    .select({ ...columns, votes: sql<number>`coalesce(${schema.voteTotals.total}, 0)::int` })
    .from(c)
    .leftJoin(schema.voteTotals, eq(schema.voteTotals.contestantId, c.id))
    .where(eq(c.contestId, contestId));
  return rows.sort((a, b) => byCode(a.code, b.code));
}

type Issue = ErrorResponse['issues'][number];
export type CreateResult = { contestant: Contestant } | { status: 400 | 409; issue: Issue };

/**
 * Inserts a contestant. Uniqueness is left to Postgres (`contestants_contest_code_unique`), not
 * checked first, so two admins adding the same code at once can't both succeed.
 */
export async function createContestant(input: ContestantCreate): Promise<CreateResult> {
  try {
    const [contestant] = await db().insert(c).values(input).returning(columns);
    if (!contestant) throw new Error('insert returned no row');
    return { contestant };
  } catch (err) {
    switch (pgCode(err)) {
      case '23505': {
        const [holder] = await db()
          .select({ name: c.name })
          .from(c)
          .where(and(eq(c.contestId, input.contestId), eq(c.code, input.code)));
        const who = holder ? ` by ${holder.name}` : '';
        return {
          status: 409,
          issue: {
            path: 'code',
            message: `${input.code} is already used${who} in this contest. Codes are unique per contest.`,
          },
        };
      }
      case '23503':
        return { status: 400, issue: { path: 'contestId', message: 'No such contest.' } };
      default:
        throw err;
    }
  }
}

/** Applies a change; undefined when no contestant has that id. */
export async function updateContestant(id: string, patch: ContestantUpdate) {
  const [contestant] = await db().update(c).set(patch).where(eq(c.id, id)).returning(columns);
  return contestant;
}
