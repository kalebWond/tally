import { z } from 'zod';

/**
 * Everything the recap video shows, exported from Postgres by `export.ts`. The schema is for
 * Remotion's composition props (the command-line render); the browser player imports the type only.
 */
export const RecapData = z.object({
  contest: z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    closesAt: z.string().nullable(),
  }),
  totalVotes: z.number().int(),
  /** Final standings, highest first. */
  contestants: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      imageUrl: z.string().nullable(),
      accentFrom: z.string(),
      accentTo: z.string(),
      countryCode: z.string().nullable(),
      total: z.number().int(),
    }),
  ),
  /** Cumulative totals per contestant at successive minutes with votes (quiet gaps skipped). */
  steps: z.array(z.object({ minute: z.number(), totals: z.record(z.string(), z.number()) })),
});
export type RecapData = z.infer<typeof RecapData>;
