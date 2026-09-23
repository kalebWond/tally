import { type Db, schema } from '@tally/db';
import { and, eq } from 'drizzle-orm';

/** How long an unknown (contest, code) stays cached before Postgres is asked again. */
const MISS_TTL_MS = 5000;

/**
 * Resolves (contestId, code) → contestantId. Hits are cached for the process lifetime: codes are
 * unique per contest and contestants with votes can't be deleted. Misses are re-checked after
 * MISS_TTL_MS, so a contestant added later starts receiving votes within seconds, while a flood of
 * invalid codes costs one query per code per window.
 */
export function createResolver(db: Db) {
  const hits = new Map<string, string>();
  const misses = new Map<string, number>();

  return {
    async resolve(contestId: string, code: string): Promise<string | null> {
      const key = `${contestId}:${code}`;
      const hit = hits.get(key);
      if (hit) return hit;
      const missedAt = misses.get(key);
      if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return null;

      const [row] = await db
        .select({ id: schema.contestants.id })
        .from(schema.contestants)
        .where(and(eq(schema.contestants.contestId, contestId), eq(schema.contestants.code, code)))
        .limit(1);

      if (row) {
        hits.set(key, row.id);
        misses.delete(key);
        return row.id;
      }
      misses.set(key, Date.now());
      return null;
    },
  };
}

export type Resolver = ReturnType<typeof createResolver>;
