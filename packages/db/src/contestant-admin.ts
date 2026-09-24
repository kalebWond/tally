import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client.ts';
import { pgCode } from './pg-error.ts';
import { contestants } from './schema.ts';

type NewContestant = Omit<
  typeof contestants.$inferInsert,
  'id' | 'contestId' | 'active' | 'createdAt'
>;

export type ContestantsCreated =
  | { ok: true; contestants: (typeof contestants.$inferSelect)[] }
  | { ok: false; reason: 'codes_taken'; taken: { index: number; code: string; holder: string }[] }
  | { ok: false; reason: 'no_contest' };

/**
 * Adds several contestants to a contest in one statement (F27), so they're added all together or
 * not at all. Code uniqueness is left to `contestants_contest_code_unique`; on a clash, the
 * rows whose codes are taken are reported with who holds them.
 */
export async function createContestants(
  db: Db,
  contestId: string,
  rows: NewContestant[],
): Promise<ContestantsCreated> {
  try {
    const created = await db
      .insert(contestants)
      .values(rows.map((r) => ({ ...r, contestId })))
      .returning();
    return { ok: true, contestants: created };
  } catch (err) {
    switch (pgCode(err)) {
      case '23505': {
        const holders = await db
          .select({ code: contestants.code, name: contestants.name })
          .from(contestants)
          .where(
            and(
              eq(contestants.contestId, contestId),
              inArray(
                contestants.code,
                rows.map((r) => r.code),
              ),
            ),
          );
        const byCode = new Map(holders.map((h) => [h.code, h.name]));
        const taken = rows.flatMap((r, index) => {
          const holder = byCode.get(r.code);
          return holder === undefined ? [] : [{ index, code: r.code, holder }];
        });
        return { ok: false, reason: 'codes_taken', taken };
      }
      case '23503':
        return { ok: false, reason: 'no_contest' };
      default:
        throw err;
    }
  }
}
