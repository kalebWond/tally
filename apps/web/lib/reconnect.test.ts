import { LiveCloseCodes } from '@tally/contracts';
import { describe, expect, it } from 'vitest';
import { afterClose, backoffDelay, MAX_DELAY_MS } from './reconnect';

describe('backoffDelay', () => {
  it('grows exponentially from ~0.5 s, with jitter in the upper half of each step', () => {
    for (const [attempt, base] of [
      [0, 500],
      [1, 1000],
      [2, 2000],
      [3, 4000],
    ] as const) {
      expect(backoffDelay(attempt, () => 0)).toBe(base / 2);
      expect(backoffDelay(attempt, () => 0.999999)).toBeCloseTo(base, -1);
    }
  });

  it('never waits longer than the cap, however many attempts have failed', () => {
    for (const attempt of [5, 10, 50, 1000]) {
      expect(backoffDelay(attempt, () => 0.999999)).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
  });

  it('spreads clients out: the same attempt gives different delays', () => {
    const delays = new Set(Array.from({ length: 20 }, () => backoffDelay(3)));
    expect(delays.size).toBeGreaterThan(10);
  });
});

describe('afterClose', () => {
  it('never retries an invalid contest: reconnecting cannot fix it', () => {
    expect(afterClose(LiveCloseCodes.invalidContest)).toEqual({ retry: false });
  });

  it('retries almost immediately when the gateway is restarting (1001)', () => {
    const plan = afterClose(LiveCloseCodes.goingAway, 4, () => 0.5);
    expect(plan).toEqual({ retry: true, delayMs: expect.any(Number) });
    expect(plan.retry && plan.delayMs).toBeLessThanOrEqual(1000);
  });

  it('backs off for anything else (crash, network drop, abnormal close 1006)', () => {
    expect(afterClose(1006, 3, () => 0)).toEqual({ retry: true, delayMs: 2000 });
  });
});
