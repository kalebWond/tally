import { describe, expect, it } from 'vitest';
import {
  addTotalSample,
  BURST_GAP_MS,
  type BurstState,
  drainShare,
  nextBurst,
  pulsePeriod,
  type TotalSample,
  voteRate,
} from './liveliness';

// F31: motion on the board comes from the data, so the rules that turn data into motion must be
// right: a rate that decays when votes stop, "+N" gains that are never lost or invented.

describe('voteRate', () => {
  const feed = (points: [number, number][]) =>
    points.reduce<TotalSample[]>((s, [at, total]) => addTotalSample(s, { at, total }), []);

  it('measures votes per second across the window', () => {
    // 500 votes every 250 ms = 2,000/s.
    const samples = feed(Array.from({ length: 20 }, (_, i) => [i * 250, i * 500]));
    expect(voteRate(samples, 19 * 250)).toBeCloseTo(2000, -1);
  });

  it('falls to zero when frames stop arriving', () => {
    const samples = feed([
      [0, 0],
      [1000, 1000],
      [2000, 2000],
    ]);
    expect(voteRate(samples, 2000)).toBeCloseTo(1000);
    expect(voteRate(samples, 2000 + 5000)).toBeLessThan(400);
    expect(voteRate(samples, 60_000)).toBeLessThan(40);
  });

  it('is zero with one sample, or after a reset', () => {
    expect(voteRate(feed([[0, 100]]), 500)).toBe(0);
    expect(
      voteRate(
        feed([
          [0, 5000],
          [1000, 0],
        ]),
        1000,
      ),
    ).toBe(0);
  });

  it('keeps only what the window needs', () => {
    const samples = feed(Array.from({ length: 100 }, (_, i) => [i * 250, i]));
    expect(samples.length).toBeLessThanOrEqual(3000 / 250 + 2);
  });
});

describe('pulsePeriod', () => {
  it('is slow when quiet and quick in a surge, never outside its range', () => {
    expect(pulsePeriod(0)).toBe(2.4);
    expect(pulsePeriod(5000)).toBeCloseTo(0.5);
    expect(pulsePeriod(1_000_000)).toBeCloseTo(0.5);
    expect(pulsePeriod(500)).toBeLessThan(pulsePeriod(50));
    expect(pulsePeriod(3000)).toBeLessThan(pulsePeriod(500));
  });
});

describe('nextBurst', () => {
  it('starts counting from the first total without a burst', () => {
    const r = nextBurst(null, 1_900_000, 0);
    expect(r.burst).toBeNull();
    expect(r.state.shown).toBe(1_900_000);
  });

  it('shows at most one burst per gap, and adds the gains in between to the next', () => {
    let state: BurstState | null = nextBurst(null, 100, 0).state;
    const shown: number[] = [];
    // A frame every 250 ms with +10 each, for 4 s.
    for (let t = 250, total = 110; t <= 4000; t += 250, total += 10) {
      const r = nextBurst(state, total, t);
      state = r.state;
      if (r.burst !== null) shown.push(r.burst);
    }
    expect(shown.length).toBeLessThanOrEqual(Math.ceil(4000 / BURST_GAP_MS));
    // Nothing lost: every gain is in a burst or still waiting.
    expect(shown.reduce((a, b) => a + b, 0) + (260 - (state?.shown ?? 0))).toBe(160);
  });

  it('says a gain is pending inside the gap, so it can be shown when the gap ends', () => {
    const first = nextBurst({ shown: 0, at: 0 }, 5, 1000);
    expect(first.burst).toBe(5);
    const early = nextBurst(first.state, 9, 1100);
    expect(early).toMatchObject({ burst: null, pending: true });
    expect(nextBurst(early.state, 9, 1000 + BURST_GAP_MS).burst).toBe(4);
  });

  it('never shows a negative gain', () => {
    const r = nextBurst({ shown: 500, at: 0 }, 200, 10_000);
    expect(r.burst).toBeNull();
    expect(r.state.shown).toBe(200);
  });
});

describe('drainShare', () => {
  it('fills as votes pile up and drains toward empty', () => {
    let peak = 0;
    const shares = [1000, 5000, 4000, 1000, 0].map((pending) => {
      const r = drainShare(pending, peak);
      peak = r.peak;
      return r.share;
    });
    expect(shares).toEqual([1, 1, 0.8, 0.2, 0]);
  });

  it('forgets the old peak once the queue has emptied', () => {
    expect(drainShare(0, 5000).peak).toBe(0);
    expect(drainShare(100, 0).share).toBe(1);
  });
});
