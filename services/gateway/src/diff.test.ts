import { describe, expect, it } from 'vitest';
import { diffTotals } from './diff.js';

const a = '00000000-0000-4000-8000-00000000000a';
const b = '00000000-0000-4000-8000-00000000000b';
const c = '00000000-0000-4000-8000-00000000000c';

describe('diffTotals', () => {
  it('returns only contestants whose total changed, with absolute values', () => {
    const prev = new Map([
      [a, 10],
      [b, 5],
    ]);
    const next = new Map([
      [a, 10],
      [b, 7],
    ]);
    expect(diffTotals(prev, next)).toEqual([{ contestantId: b, total: 7 }]);
  });

  it('includes a contestant seen for the first time', () => {
    expect(
      diffTotals(
        new Map([[a, 1]]),
        new Map([
          [a, 1],
          [c, 1],
        ]),
      ),
    ).toEqual([{ contestantId: c, total: 1 }]);
  });

  it('returns nothing when nothing changed', () => {
    const same = new Map([[a, 3]]);
    expect(diffTotals(same, new Map(same))).toEqual([]);
  });
});
