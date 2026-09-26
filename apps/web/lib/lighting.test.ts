import { describe, expect, it } from 'vitest';
import {
  advance,
  aimAngle,
  CUE_GAP_MS,
  cueOf,
  initialLighting,
  type Lighting,
  nextChangeAt,
  SPOTLIGHT_MS,
  STAGE_HOLD_MS,
  swayPeriod,
} from './lighting';

const open = (leaders: string[]) => ({ status: 'open' as const, leaders, counted: true });
/** Voting closed; `counted` once the queue has emptied (the true result is in). */
const closed = (leaders: string[], counted = true) => ({
  status: 'closed' as const,
  leaders,
  counted,
});

/** Feeds readings in order: [time, input] pairs. */
function run(steps: [number, Parameters<typeof advance>[1]][], from: Lighting = initialLighting) {
  return steps.reduce((l, [at, input]) => advance(l, input, at), from);
}

describe('first reading', () => {
  it('shows the scene as it is: the leader lit at once, nothing to play', () => {
    const l = run([[1000, open(['a'])]]);
    expect(l.shown).toBe('a');
    expect(cueOf(l)).toBe('live');
    expect(l.spotlight).toBeNull();
  });

  it('a page opened on a closed, counted contest shows the finale settled, not played', () => {
    const l = run([[1000, closed(['a'])]]);
    expect(cueOf(l)).toBe('finale');
    expect(l.finale).toBe('settled');
  });

  it('a page opened while the last votes are counted plays the finale when counting ends', () => {
    const counting = run([[1000, closed(['a'], false)]]);
    expect(cueOf(counting)).toBe('live');
    expect(counting.finale).toBe('counting');
    const done = run([[4000, closed(['a'])]], counting);
    expect(cueOf(done)).toBe('finale');
    expect(done.finale).toBe('live');
  });

  it('a contest not yet open keeps the lights down', () => {
    expect(cueOf(run([[0, { status: 'draft', leaders: [], counted: true }]]))).toBe('dark');
  });
});

describe('a lead change', () => {
  it('spotlights the new leader, then goes back to the sway', () => {
    const l = run([
      [0, open(['a'])],
      [10_000, open(['b'])],
    ]);
    expect(cueOf(l)).toBe('spotlight');
    expect(l.spotlight?.target).toBe('b');
    const after = advance(l, open(['b']), 10_000 + SPOTLIGHT_MS);
    expect(cueOf(after)).toBe('live');
  });

  it('turns the stage to the new colours only once the lead has held', () => {
    let l = run([
      [0, open(['a'])],
      [10_000, open(['b'])],
    ]);
    expect(l.shown).toBe('a');
    expect(nextChangeAt(l)).toBe(10_000 + SPOTLIGHT_MS);
    l = advance(l, open(['b']), 10_000 + STAGE_HOLD_MS - 1);
    expect(l.shown).toBe('a');
    l = advance(l, open(['b']), 10_000 + STAGE_HOLD_MS);
    expect(l.shown).toBe('b');
  });

  it('a close race swapping every second never repaints the stage or cues again inside the gap', () => {
    const steps: [number, ReturnType<typeof open>][] = [[0, open(['a'])]];
    for (let t = 10_000; t < 10_000 + CUE_GAP_MS; t += 1000)
      steps.push([t, open([(t / 1000) % 2 ? 'b' : 'a'])]);
    let cues = 0;
    let l = initialLighting;
    const shown = new Set<string | null>();
    for (const [at, input] of steps) {
      const before = l.lastCueAt;
      l = advance(l, input, at);
      if (l.lastCueAt !== before && at > 0) cues++;
      shown.add(l.shown);
    }
    expect(cues).toBe(1);
    expect([...shown]).toEqual(['a']);
  });

  it('a second change mid-swing turns the same spotlight to the newest leader', () => {
    const l = run([
      [0, open(['a'])],
      [10_000, open(['b'])],
      [10_500, open(['c'])],
    ]);
    expect(l.spotlight).toEqual({ target: 'c', until: 10_000 + SPOTLIGHT_MS });
  });

  it('the first votes of a contest are not a lead change', () => {
    const l = run([
      [0, open([])],
      [5000, open(['a'])],
    ]);
    expect(cueOf(l)).toBe('live');
  });
});

describe('the close', () => {
  it('waits for the counting: the beams sway on while votes accepted before it are counted', () => {
    const l = run([
      [0, open(['a'])],
      [20_000, closed(['a'], false)],
    ]);
    expect(cueOf(l)).toBe('live');
    expect(l.finale).toBe('counting');
  });

  it('a late count that changes the lead still gets its spotlight', () => {
    const l = run([
      [0, open(['a'])],
      [20_000, closed(['a'], false)],
      [22_000, closed(['b'], false)],
    ]);
    expect(cueOf(l)).toBe('spotlight');
    expect(l.spotlight?.target).toBe('b');
  });

  it('plays the finale when the last vote is counted, in the final winner’s colours at once', () => {
    const l = run([
      [0, open(['a'])],
      [20_000, closed(['a'], false)],
      [22_000, closed(['b'], false)],
      [23_000, closed(['b'])],
    ]);
    expect(cueOf(l)).toBe('finale');
    expect(l.finale).toBe('live');
    expect(l.shown).toBe('b');
    expect(l.spotlight).toBeNull();
  });

  it('with nothing left to count at the close, the finale plays straight away', () => {
    const l = run([
      [0, open(['a'])],
      [1000, closed(['a'])],
    ]);
    expect(l.finale).toBe('live');
  });

  it('plays once: a reading after the finale doesn’t start it again', () => {
    const played = run([
      [0, open(['a'])],
      [1000, closed(['a'])],
    ]);
    const later = run([[9000, closed(['a'])]], played);
    expect(later.finale).toBe('live');
    expect(nextChangeAt(later)).toBeNull();
  });

  it('reopening ends the finale', () => {
    const l = run([
      [0, open(['a'])],
      [1000, closed(['a'])],
      [2000, open(['a'])],
    ]);
    expect(cueOf(l)).toBe('live');
    expect(l.finale).toBe('none');
  });
});

describe('aimAngle', () => {
  it('measures clockwise from straight up', () => {
    expect(aimAngle({ x: 0, y: 100 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(aimAngle({ x: 0, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(45);
    expect(aimAngle({ x: 100, y: 100 }, { x: 0, y: 0 })).toBeCloseTo(-45);
  });
});

describe('swayPeriod', () => {
  it('drifts when quiet and quickens with the rate, on a log scale', () => {
    expect(swayPeriod(0)).toBe(36);
    expect(swayPeriod(5000)).toBeCloseTo(3);
    expect(swayPeriod(20_000)).toBeCloseTo(3);
    expect(swayPeriod(70)).toBeLessThan(15);
    expect(swayPeriod(70)).toBeGreaterThan(8);
  });
});
