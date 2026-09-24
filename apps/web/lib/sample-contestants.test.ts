import { ContestantCreate } from '@tally/contracts';
import { describe, expect, it } from 'vitest';
import { codePrefix, hslToHex, sampleContestants } from './sample-contestants';

/** Deterministic random for repeatable draws. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('sampleContestants', () => {
  it('draws 7 valid contestants with distinct names and codes', () => {
    const rows = sampleContestants({ contestName: 'Spring Heats', random: seeded(1) });
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.name)).size).toBe(7);
    expect(rows.map((r) => r.code)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    for (const r of rows) {
      expect(
        ContestantCreate.safeParse({ contestId: '0192f3a0-7c1e-7000-8000-00000000c0de', ...r })
          .success,
      ).toBe(true);
    }
  });

  it('skips codes and names the contest already has', () => {
    const first = sampleContestants({ contestName: 'Spring Heats', random: seeded(2) });
    const rows = sampleContestants({
      contestName: 'Spring Heats',
      takenCodes: ['S1', 'S3'],
      takenNames: first.map((r) => r.name.toUpperCase()),
      random: seeded(3),
    });
    expect(rows.map((r) => r.code)).toEqual(['S2', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
    expect(rows.some((r) => first.some((f) => f.name === r.name))).toBe(false);
  });

  it('spreads accent hues evenly, so no two contestants look alike', () => {
    const hues = sampleContestants({ contestName: 'Finals', random: seeded(4) })
      .map((r) => hue(r.accentFrom))
      .sort((a, b) => a - b);
    const gaps = hues.map((h, i) => ((hues[(i + 1) % hues.length] as number) - h + 360) % 360);
    for (const gap of gaps) expect(gap).toBeGreaterThan(360 / 7 - 3);
  });

  it('draws differently each time', () => {
    const a = sampleContestants({ contestName: 'X', random: seeded(5) }).map((r) => r.name);
    const b = sampleContestants({ contestName: 'X', random: seeded(6) }).map((r) => r.name);
    expect(a).not.toEqual(b);
  });
});

describe('helpers', () => {
  it('prefixes codes with the contest name’s first letter', () => {
    expect(codePrefix('Tally Finals')).toBe('T');
    expect(codePrefix('2026 finals')).toBe('F');
    expect(codePrefix('2026')).toBe('C');
  });

  it('converts HSL to hex', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#FF0000');
    expect(hslToHex(120, 1, 0.25)).toBe('#008000');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000FF');
  });
});
