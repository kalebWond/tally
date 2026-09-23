import { z } from 'zod';
import { ContestStatus } from './enums.ts';

// Contest lifecycle (SPEC §7): POST /api/contests/:id/status.

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
