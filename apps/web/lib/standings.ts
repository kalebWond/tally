import type { ContestStatus, LiveMessage } from '@tally/contracts';

/** A contestant's display details, loaded from Postgres by the server component. */
export interface Entrant {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  accentFrom: string | null;
  accentTo: string | null;
  countryCode: string | null;
  /** Deactivated contestants stay known to the page (their totals still arrive) but aren't shown. */
  active: boolean;
}

/** Live totals as received from the gateway: contestantId → absolute total. */
export interface Totals {
  totals: ReadonlyMap<string, number>;
  totalVotes: number;
  /** Contest status from the gateway; null = not known there, use the server-rendered one. */
  status: ContestStatus | null;
}

export interface Standing extends Entrant {
  total: number;
  /** Competition ranking: tied totals share a rank (1, 2, 2, 4). */
  rank: number;
}

export const emptyTotals = (): Totals => ({ totals: new Map(), totalVotes: 0, status: null });

/** Snapshots replace everything; updates overwrite only the contestants they name; heartbeats change nothing. */
export function applyFrame(state: Totals, frame: LiveMessage): Totals {
  if (frame.type === 'heartbeat') return state;
  if (frame.type === 'snapshot') {
    return {
      totals: new Map(frame.totals.map((t) => [t.contestantId, t.total])),
      totalVotes: frame.totalVotes,
      status: frame.status,
    };
  }
  const totals = new Map(state.totals);
  for (const t of frame.changed) totals.set(t.contestantId, t.total);
  return { totals, totalVotes: frame.totalVotes, status: frame.status };
}

const byCode = new Intl.Collator('en', { numeric: true }).compare;

/**
 * Active contestants only, highest total first. Ties break on code in natural order (C2 before
 * C10), so equal rows hold their positions from frame to frame instead of flickering.
 */
export function rank(
  entrants: readonly Entrant[],
  totals: ReadonlyMap<string, number>,
): Standing[] {
  const sorted = entrants
    .filter((e) => e.active)
    .map((e) => ({ ...e, total: totals.get(e.id) ?? 0 }))
    .sort((a, b) => b.total - a.total || byCode(a.code, b.code));

  let previous: { total: number; rank: number } | undefined;
  return sorted.map((row, i) => {
    const r = previous && previous.total === row.total ? previous.rank : i + 1;
    previous = { total: row.total, rank: r };
    return { ...row, rank: r };
  });
}

/** Contestants that have totals but no details on the page: added after it loaded. */
export function unknownIds(entrants: readonly Entrant[], totals: ReadonlyMap<string, number>) {
  const known = new Set(entrants.map((e) => e.id));
  return [...totals.keys()].filter((id) => !known.has(id));
}
