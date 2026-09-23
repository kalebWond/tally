import { spring } from 'motion';
import { describe, expect, it } from 'vitest';
import { COUNTER_SPRING } from './counter-spring';

// F9: a vote count must never visibly go backwards or past its real value. Simulates the same
// spring generator useSpring runs, retargeted every 250 ms with velocity carried across the
// retarget (what useSpring does), sampled once per 60 Hz frame, rounded like the UI.

const FRAME_MS = 1000 / 60;
const UPDATE_MS = 250;

function simulate(targets: number[], config: typeof COUNTER_SPRING) {
  let value = targets[0] ?? 0;
  let velocity = 0;
  const shown: { value: number; target: number }[] = [];

  for (const target of targets.slice(1)) {
    const gen = spring({ keyframes: [value, target], velocity, ...config });
    for (let t = FRAME_MS; t <= UPDATE_MS; t += FRAME_MS) {
      shown.push({ value: Math.round(gen.next(t).value), target });
    }
    const end = gen.next(UPDATE_MS).value;
    velocity = ((end - gen.next(UPDATE_MS - 1).value) / 1) * 1000; // units per second
    value = end;
  }
  return shown;
}

/** A steady stream of increases, like a busy contestant: +3 to +40 per 250 ms. */
function risingTargets(n: number, seed = 7) {
  let x = seed;
  const next = () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
  const targets = [1000];
  for (let i = 1; i < n; i++) targets.push((targets[i - 1] ?? 0) + 3 + Math.floor(next() * 38));
  return targets;
}

describe('COUNTER_SPRING', () => {
  it('never shows a lower number than it showed a frame earlier', () => {
    const shown = simulate(risingTargets(60), COUNTER_SPRING);
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]?.value).toBeGreaterThanOrEqual(shown[i - 1]?.value ?? 0);
    }
  });

  it('never overshoots the real total', () => {
    for (const { value, target } of simulate(risingTargets(60, 99), COUNTER_SPRING)) {
      expect(value).toBeLessThanOrEqual(target);
    }
  });

  it('settles on the exact total once updates stop', () => {
    const gen = spring({ keyframes: [100, 163], velocity: 250, ...COUNTER_SPRING });
    expect(Math.round(gen.next(2000).value)).toBe(163);
  });

  it('keeps up: trails a steady 250 ms stream by less than two updates', () => {
    const targets = Array.from({ length: 40 }, (_, i) => 1000 + i * 20);
    const shown = simulate(targets, COUNTER_SPRING);
    const lastFrame = shown.at(-1);
    expect((lastFrame?.target ?? 0) - (lastFrame?.value ?? 0)).toBeLessThan(40);
  });
});
