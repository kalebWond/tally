/** One poll of the generator's /status. */
export type RateSample = {
  at: number;
  sentTotal: number;
  startedAt: number | null;
  currentRate: number;
};

/** One chart point: the rate asked for and the rate actually delivered, in votes/s. */
export type RatePoint = { at: number; target: number; actual: number | null };

export const HISTORY_WINDOW_MS = 60_000;

/**
 * Adds a chart point for `cur`, measured against the previous poll, and drops points older than
 * the window. `actual` is null (a gap in the line) when the delta can't be trusted: across two
 * different runs (sentTotal restarts from zero) or when the polls are out of order.
 */
export function addSample(
  points: readonly RatePoint[],
  prev: RateSample | undefined,
  cur: RateSample,
  windowMs = HISTORY_WINDOW_MS,
): RatePoint[] {
  const seconds = prev ? (cur.at - prev.at) / 1000 : 0;
  const sameRun =
    prev !== undefined && prev.startedAt === cur.startedAt && cur.sentTotal >= prev.sentTotal;
  const actual =
    prev && sameRun && seconds > 0 ? Math.round((cur.sentTotal - prev.sentTotal) / seconds) : null;
  return [...points, { at: cur.at, target: cur.currentRate, actual }].filter(
    (p) => p.at > cur.at - windowMs,
  );
}
