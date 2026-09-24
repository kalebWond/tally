import { z } from 'zod';
import { ContestStatus } from './enums.ts';

// Contest admin (SPEC §7): POST /api/contests, DELETE /api/contests/:id,
// POST /api/contests/:id/status.

/** Open (from draft, or reopen from closed) or close. Nothing goes back to draft. */
export const ContestStatusChange = z.object({ status: z.enum(['open', 'closed']) });
export type ContestStatusChange = z.infer<typeof ContestStatusChange>;

export const Contest = z.object({
  id: z.uuid(),
  name: z.string(),
  status: ContestStatus,
  /** When the current voting window opened; null = open since creation. */
  opensAt: z.iso.datetime().nullable(),
  /** When it closed; votes ingest accepted from this instant on are dead-lettered. */
  closesAt: z.iso.datetime().nullable(),
});
export type Contest = z.infer<typeof Contest>;

/** A new contest starts as a draft. Names are unique ignoring case; runs of spaces become one. */
export const ContestCreate = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'is required')
      .max(80, 'must be 80 characters or fewer')
      .transform((n) => n.replace(/\s+/g, ' ')),
  })
  .strict();
export type ContestCreate = z.infer<typeof ContestCreate>;
