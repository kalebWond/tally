import type { LiveSnapshot, LiveUpdate } from '@tally/contracts';
import { describe, expect, it } from 'vitest';
import { applyFrame, type Entrant, emptyTotals, rank, unknownIds } from './standings';

const CONTEST = '0192f3a0-7c1e-7000-8000-00000000c0de';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entrant = (n: number, code = `C${n}`): Entrant => ({
  id: id(n),
  code,
  name: `Contestant ${n}`,
  imageUrl: null,
  accentFrom: null,
  accentTo: null,
  countryCode: null,
  active: true,
});

const snapshot = (
  totals: [number, number][],
  totalVotes = 0,
  status: LiveSnapshot['status'] = 'open',
): LiveSnapshot => ({
  type: 'snapshot',
  contestId: CONTEST,
  totals: totals.map(([n, total]) => ({ contestantId: id(n), total })),
  totalVotes,
  status,
  ts: 1,
});

const update = (
  changed: [number, number][],
  totalVotes = 0,
  status: LiveUpdate['status'] = 'open',
): LiveUpdate => ({
  type: 'update',
  contestId: CONTEST,
  changed: changed.map(([n, total]) => ({ contestantId: id(n), total })),
  totalVotes,
  status,
  ts: 2,
});

describe('applyFrame — contest status (F16)', () => {
  it('takes the status from every snapshot and update, so a close shows without a reload', () => {
    const open = applyFrame(emptyTotals(), snapshot([[1, 5]], 5, 'open'));
    const closed = applyFrame(open, update([], 5, 'closed'));
    expect(closed).toMatchObject({ status: 'closed', totalVotes: 5 });
    expect(closed.totals.get(id(1))).toBe(5);
  });

  it('keeps null when the gateway does not know, leaving the page on its rendered status', () => {
    expect(applyFrame(emptyTotals(), snapshot([], 0, null)).status).toBeNull();
  });
});

describe('applyFrame', () => {
  it('a snapshot replaces all totals', () => {
    const before = applyFrame(
      emptyTotals(),
      snapshot(
        [
          [1, 9],
          [2, 4],
        ],
        13,
      ),
    );
    const after = applyFrame(before, snapshot([[1, 10]], 10));
    expect([...after.totals]).toEqual([[id(1), 10]]);
    expect(after.totalVotes).toBe(10);
  });

  it('an update changes only the contestants it names', () => {
    const state = applyFrame(
      emptyTotals(),
      snapshot(
        [
          [1, 9],
          [2, 4],
        ],
        13,
      ),
    );
    const next = applyFrame(state, update([[2, 6]], 15));
    expect(Object.fromEntries(next.totals)).toEqual({ [id(1)]: 9, [id(2)]: 6 });
    expect(next.totalVotes).toBe(15);
  });

  it('does not mutate the previous state (React relies on a new object)', () => {
    const state = applyFrame(emptyTotals(), snapshot([[1, 1]]));
    applyFrame(state, update([[1, 2]]));
    expect(state.totals.get(id(1))).toBe(1);
  });
});

describe('rank', () => {
  it('sorts by total, highest first', () => {
    const rows = rank(
      [entrant(1), entrant(2), entrant(3)],
      new Map([
        [id(1), 5],
        [id(2), 9],
        [id(3), 7],
      ]),
    );
    expect(rows.map((r) => r.code)).toEqual(['C2', 'C3', 'C1']);
  });

  it('breaks ties by code in natural order, so equal rows never swap places between frames', () => {
    const rows = rank([entrant(10), entrant(2), entrant(1)], new Map());
    expect(rows.map((r) => r.code)).toEqual(['C1', 'C2', 'C10']);
  });

  it('gives tied contestants the same rank (1, 2, 2, 4)', () => {
    const totals = new Map([
      [id(1), 9],
      [id(2), 5],
      [id(3), 5],
      [id(4), 1],
    ]);
    const rows = rank([entrant(1), entrant(2), entrant(3), entrant(4)], totals);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('leaves out deactivated contestants and ranks the rest without gaps', () => {
    const rows = rank(
      [entrant(1), { ...entrant(2), active: false }, entrant(3)],
      new Map([
        [id(1), 5],
        [id(2), 9],
        [id(3), 7],
      ]),
    );
    expect(rows.map((r) => [r.code, r.rank])).toEqual([
      ['C3', 1],
      ['C1', 2],
    ]);
  });

  it('shows contestants with no votes yet at zero', () => {
    const [row] = rank([entrant(1)], new Map());
    expect(row).toMatchObject({ code: 'C1', total: 0, rank: 1 });
  });
});

describe('unknownIds', () => {
  it('finds totals for contestants the page has no details for (added after load)', () => {
    const totals = new Map([
      [id(1), 3],
      [id(99), 1],
    ]);
    expect(unknownIds([entrant(1)], totals)).toEqual([id(99)]);
  });

  it('does not treat a deactivated contestant as unknown, so its totals never trigger a refresh', () => {
    expect(unknownIds([{ ...entrant(1), active: false }], new Map([[id(1), 3]]))).toEqual([]);
  });
});

describe('applyFrame — heartbeat', () => {
  it('leaves the totals untouched (it only proves the connection is alive)', () => {
    const state = applyFrame(emptyTotals(), snapshot([[1, 5]], 5));
    expect(applyFrame(state, { type: 'heartbeat', ts: 3 })).toBe(state);
  });
});
