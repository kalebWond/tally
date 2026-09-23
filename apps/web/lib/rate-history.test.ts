import { describe, expect, it } from 'vitest';
import { addSample, type RatePoint, type RateSample } from './rate-history';

const sample = (
  at: number,
  sentTotal: number,
  currentRate = 1000,
  startedAt: number | null = 1,
): RateSample => ({
  at,
  sentTotal,
  startedAt,
  currentRate,
});

describe('addSample', () => {
  it('measures delivered votes/s from the change in sentTotal, over the real time between polls', () => {
    const points = addSample([], sample(0, 0), sample(1250, 2500));
    expect(points).toEqual([{ at: 1250, target: 1000, actual: 2000 }]);
  });

  it('has no measurement for the first poll, only the target', () => {
    expect(addSample([], undefined, sample(0, 500))).toEqual([
      { at: 0, target: 1000, actual: null },
    ]);
  });

  it('leaves a gap rather than a spike or a negative rate when a new run resets the counters', () => {
    const [point] = addSample([], sample(0, 90_000, 2000, 1), sample(1000, 400, 500, 2));
    expect(point?.actual).toBeNull();
  });

  it('leaves a gap when a slow poll resolves after a newer one', () => {
    expect(addSample([], sample(2000, 100), sample(1000, 50))[0]?.actual).toBeNull();
  });

  it('reads 0, not a gap, while stopped: nothing is being sent', () => {
    const [point] = addSample([], sample(0, 700, 0, null), sample(1000, 700, 0, null));
    expect(point).toEqual({ at: 1000, target: 0, actual: 0 });
  });

  it('keeps only the last window of points', () => {
    let points: RatePoint[] = [];
    let prev: RateSample | undefined;
    for (let s = 0; s <= 120; s++) {
      const cur = sample(s * 1000, s * 1000);
      points = addSample(points, prev, cur, 60_000);
      prev = cur;
    }
    expect(points).toHaveLength(60);
    expect(points[0]?.at).toBe(61_000);
  });
});
