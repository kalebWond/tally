import { z } from 'zod';
import { VoteCode } from './vote.ts';

// Admin contestant API (SPEC §7): GET/POST/PATCH /api/contestants.

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * ISO 3166-1 alpha-2, uppercased. Intl knows the list: an unassigned code comes back unnamed,
 * and ZZ comes back as "Unknown Region".
 */
export const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'must be a two-letter country code')
  .refine(
    (c) => ![c, 'Unknown Region'].includes(regions.of(c) ?? c),
    'is not a known country code',
  );

/** `#RRGGBB`, uppercased like the seed data. */
export const HexColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like #1E90FF')
  .transform((c) => c.toUpperCase());

/** Illustrated or generated images only (CLAUDE.md: no photos of real people). https only. */
export const ImageUrl = z.url({ protocol: /^https$/, error: 'must be an https URL' }).max(2048);

const Name = z.string().trim().min(1, 'is required').max(80, 'must be 80 characters or fewer');

/** Fields an admin can change after creation. The code is fixed: consumers cache it. */
const editable = {
  name: Name,
  imageUrl: ImageUrl.nullable(),
  accentFrom: HexColour.nullable(),
  accentTo: HexColour.nullable(),
  countryCode: CountryCode.nullable(),
};

/** `POST /api/contestants`. New contestants are active. */
export const ContestantCreate = z.object({
  contestId: z.uuid(),
  code: VoteCode,
  name: editable.name,
  imageUrl: editable.imageUrl.default(null),
  accentFrom: editable.accentFrom.default(null),
  accentTo: editable.accentTo.default(null),
  countryCode: editable.countryCode.default(null),
});
export type ContestantCreate = z.infer<typeof ContestantCreate>;

/**
 * `PATCH /api/contestants/:id`: any subset of the editable fields, plus `active`. Strict, so a
 * request that tries to change `code` or `contestId` is refused rather than silently ignored.
 * Deactivating stops counting: later votes for the code are dead-lettered (`inactive_contestant`).
 */
export const ContestantUpdate = z
  .strictObject({
    name: editable.name,
    imageUrl: editable.imageUrl,
    accentFrom: editable.accentFrom,
    accentTo: editable.accentTo,
    countryCode: editable.countryCode,
    active: z.boolean(),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'nothing to change');
export type ContestantUpdate = z.infer<typeof ContestantUpdate>;

/** A contestant as the admin API returns it. */
export const Contestant = z.object({
  id: z.uuid(),
  contestId: z.uuid(),
  code: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  accentFrom: z.string().nullable(),
  accentTo: z.string().nullable(),
  countryCode: z.string().nullable(),
  active: z.boolean(),
});
export type Contestant = z.infer<typeof Contestant>;

/** Illustrated avatar for a name, in the seed's style. Not a photo of anyone. */
export const avatarUrl = (seed: string) =>
  `https://api.dicebear.com/10.x/notionists/svg?seed=${encodeURIComponent(seed)}`;
