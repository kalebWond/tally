import { type Db, schema } from '@tally/db';
import { and, eq } from 'drizzle-orm';

/** How long a lookup is trusted before Postgres is asked again, found or not. */
export const RESOLVER_TTL_MS = 5000;

export type Resolution =
  | { kind: 'counted'; contestantId: string }
  /** No contestant has this code in this contest. */
  | { kind: 'unknown' }
  /** The contestant exists but an admin deactivated it: the vote is dead-lettered, not counted. */
  | { kind: 'inactive'; contestantId: string };

/**
 * Resolves (contestId, code) → contestant. Codes never change once created, but a contestant can
 * be added or (de)activated at any time, so every answer, hit or miss, is re-checked after
 * RESOLVER_TTL_MS. An admin change reaches every consumer within 5 s, and a flood of votes costs
 * at most one query per code per window.
 */
export function createResolver(db: Db, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; row: { id: string; active: boolean } | undefined }>();

  return {
    async resolve(contestId: string, code: string): Promise<Resolution> {
      const key = `${contestId}:${code}`;
      let entry = cache.get(key);
      if (!entry || now() - entry.at >= RESOLVER_TTL_MS) {
        const [row] = await db
          .select({ id: schema.contestants.id, active: schema.contestants.active })
          .from(schema.contestants)
          .where(
            and(eq(schema.contestants.contestId, contestId), eq(schema.contestants.code, code)),
          )
          .limit(1);
        entry = { at: now(), row };
        cache.set(key, entry);
      }
      const { row } = entry;
      if (!row) return { kind: 'unknown' };
      return row.active
        ? { kind: 'counted', contestantId: row.id }
        : { kind: 'inactive', contestantId: row.id };
    },
  };
}

export type Resolver = ReturnType<typeof createResolver>;
