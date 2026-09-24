/**
 * The results board's data-driven motion (F31): how fast the LIVE dot beats, when a row shows a
 * "+N", and how full a draining backlog bar is. Pure, so the timing rules are tested.
 */

/** One reading of the contest's total, taken whenever a frame changes it. */
export type TotalSample = { at: number; total: number };

export const RATE_WINDOW_MS = 3000;

/**
 * Keeps the samples needed to measure the rate over the window: everything inside it, plus the
 * newest one before it as the baseline.
 */
export function addTotalSample(
  samples: readonly TotalSample[],
  sample: TotalSample,
  windowMs = RATE_WINDOW_MS,
): TotalSample[] {
  const all = [...samples, sample];
  const firstInside = all.findIndex((s) => s.at > sample.at - windowMs);
  return all.slice(Math.max(0, firstInside - 1));
}

/**
 * Votes per second over the window ending `now`. Measured to `now`, not to the last sample, so
 * the rate falls to 0 when frames stop coming. 0 when the total went down (a reset).
 */
export function voteRate(
  samples: readonly TotalSample[],
  now: number,
  windowMs = RATE_WINDOW_MS,
): number {
  const last = samples.at(-1);
  if (!last) return 0;
  const base = samples.findLast((s) => s.at <= now - windowMs) ?? samples[0];
  if (!base || base === last) return 0;
  const seconds = (now - base.at) / 1000;
  return seconds > 0 ? Math.max(0, last.total - base.total) / seconds : 0;
}

const QUIET_PERIOD_S = 2.4;
const BUSY_PERIOD_S = 0.5;
const BUSY_RATE = 5000;

/**
 * One beat of the LIVE dot, in seconds: 2.4 s when nothing arrives, quickening on a log scale
 * to 0.5 s at 5,000 votes/s. Log, because 50/s and 5,000/s should both look alive.
 */
export function pulsePeriod(perSec: number): number {
  if (perSec <= 1) return QUIET_PERIOD_S;
  const t = Math.min(1, Math.log(perSec) / Math.log(BUSY_RATE));
  return QUIET_PERIOD_S + (BUSY_PERIOD_S - QUIET_PERIOD_S) * t;
}

/** At most one "+N" per row this often; gains in between are added to the next one. */
export const BURST_GAP_MS = 800;

export type BurstState = { shown: number; at: number };

/**
 * Whether a row shows a "+N" now. `null` state means the row just appeared: its first total is
 * where counting starts, not a gain. A total that went down (a reset, a resync) moves the
 * baseline without a burst. A gain inside the gap waits: `burst` is null and `pending` is true,
 * and the caller asks again once the gap is over.
 */
export function nextBurst(
  state: BurstState | null,
  total: number,
  now: number,
  gapMs = BURST_GAP_MS,
): { state: BurstState; burst: number | null; pending: boolean } {
  if (state === null)
    return { state: { shown: total, at: -Infinity }, burst: null, pending: false };
  if (total <= state.shown)
    return { state: { shown: total, at: state.at }, burst: null, pending: false };
  if (now - state.at < gapMs) return { state, burst: null, pending: true };
  return { state: { shown: total, at: now }, burst: total - state.shown, pending: false };
}

/**
 * How full the backlog bar is, 0–1: the waiting count against the highest it reached since the
 * queue was last empty, so the bar fills as votes pile up and drains to nothing as they're
 * counted. Returns the new peak with it.
 */
export function drainShare(pending: number, peak: number): { share: number; peak: number } {
  if (pending <= 0) return { share: 0, peak: 0 };
  const top = Math.max(peak, pending);
  return { share: pending / top, peak: top };
}
