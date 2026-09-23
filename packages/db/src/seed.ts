import { avatarUrl } from '@tally/contracts';
import type { Db } from './client.ts';
import { contestants, contests } from './schema.ts';

/** Fixed so the generator, gateway and web have a known contest to target. */
export const SEED_CONTEST_ID = '0192f3a0-7c1e-7000-8000-00000000c0de';

// Fictional people only. Avatars are generated illustrations, seeded by name.

const roster = [
  { name: 'Mira Kestrel', countryCode: 'NO', accentFrom: '#0EA5E9', accentTo: '#6366F1' },
  { name: 'Tomas Veyra', countryCode: 'PT', accentFrom: '#F97316', accentTo: '#E11D48' },
  { name: 'Ada Lunetti', countryCode: 'IT', accentFrom: '#A855F7', accentTo: '#EC4899' },
  { name: 'Ravi Sorrellan', countryCode: 'IN', accentFrom: '#F59E0B', accentTo: '#EF4444' },
  { name: 'Noor Halvessen', countryCode: 'EG', accentFrom: '#14B8A6', accentTo: '#0EA5E9' },
  { name: 'Felix Arnhald', countryCode: 'DE', accentFrom: '#64748B', accentTo: '#0F172A' },
  { name: 'Sable Okorafe', countryCode: 'NG', accentFrom: '#22C55E', accentTo: '#15803D' },
  { name: 'Juno Takamire', countryCode: 'JP', accentFrom: '#F43F5E', accentTo: '#FB7185' },
  { name: 'Lio Varganyi', countryCode: 'HU', accentFrom: '#84CC16', accentTo: '#EAB308' },
  { name: 'Eska Morrowdal', countryCode: 'IS', accentFrom: '#38BDF8', accentTo: '#A5F3FC' },
];

/**
 * Idempotent: inserts only what is missing and never overwrites existing rows,
 * so re-running it can't undo admin edits, reopen a closed contest, or touch votes.
 */
export async function seed(db: Db) {
  await db
    .insert(contests)
    .values({ id: SEED_CONTEST_ID, name: 'Tally Showcase', status: 'open' })
    .onConflictDoNothing();

  await db
    .insert(contestants)
    .values(
      roster.map((c, i) => ({
        ...c,
        contestId: SEED_CONTEST_ID,
        code: `C${i + 1}`,
        imageUrl: avatarUrl(c.name),
      })),
    )
    .onConflictDoNothing();
}
