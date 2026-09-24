import {
  type ContestStatus,
  type LiveBacklog,
  type LiveMessage,
  MINUTES_WINDOW,
} from '@tally/contracts';

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
  /** Minute start (epoch ms) → contest votes that minute, within the gateway's window (F17). */
  minutes: ReadonlyMap<number, number>;
  /** The window's last minute; null before the first snapshot. */
  minutesTo: number | null;
  /** Votes accepted but not yet counted, across all contests (F29); null = unknown. */
  backlog: LiveBacklog;
}

export interface Standing extends Entrant {
  total: number;
  /** Competition ranking: tied totals share a rank (1, 2, 2, 4). */
  rank: number;
}

export const emptyTotals = (): Totals => ({
  totals: new Map(),
  totalVotes: 0,
  status: null,
  minutes: new Map(),
  minutesTo: null,
  backlog: null,
});

const MINUTE = 60_000;

/** Snapshots replace everything; updates overwrite only the contestants they name; heartbeats change nothing. */
export function applyFrame(state: Totals, frame: LiveMessage): Totals {
  if (frame.type === 'heartbeat') return state;
  if (frame.type === 'snapshot') {
    return {
      totals: new Map(frame.totals.map((t) => [t.contestantId, t.total])),
      totalVotes: frame.totalVotes,
      status: frame.status,
      minutes: new Map(frame.minutes.map((m) => [m.minute, m.count])),
      minutesTo: frame.minutesTo,
      backlog: frame.backlog,
    };
  }
  const totals = new Map(state.totals);
  for (const t of frame.changed) totals.set(t.contestantId, t.total);
  // Minutes that slid out of the window are dropped, so the map never grows past it.
  const from = frame.minutesTo - (MINUTES_WINDOW - 1) * MINUTE;
  const minutes = new Map([...state.minutes].filter(([m]) => m >= from));
  for (const m of frame.minutes) minutes.set(m.minute, m.count);
  return {
    totals,
    totalVotes: frame.totalVotes,
    status: frame.status,
    minutes,
    minutesTo: frame.minutesTo,
    backlog: frame.backlog,
  };
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

/**
 * The chart's points: one per minute across the window ending at `minutesTo`, a minute with no
 * votes as 0 rather than a gap. Starts at the contest's opening minute when that is later, so
 * a contest opened 5 minutes ago shows 5 minutes, not 25 empty ones before it.
 */
export function minuteSeries(
  minutes: ReadonlyMap<number, number>,
  minutesTo: number,
  opensAt: number | null = null,
): { minute: number; count: number }[] {
  const windowStart = minutesTo - (MINUTES_WINDOW - 1) * MINUTE;
  const opened = opensAt === null ? windowStart : Math.floor(opensAt / MINUTE) * MINUTE;
  const start = Math.min(minutesTo, Math.max(windowStart, opened));
  const points = [];
  for (let m = start; m <= minutesTo; m += MINUTE)
    points.push({ minute: m, count: minutes.get(m) ?? 0 });
  return points;
}

/**
 * How big the results page's title can be (F30): long names step down so the vote count keeps
 * its place beside them. Counted in characters; the display face is condensed and uppercase.
 */
export function titleSize(name: string): 'short' | 'long' | 'xlong' {
  const length = [...name.trim()].length;
  return length <= 20 ? 'short' : length <= 32 ? 'long' : 'xlong';
}
