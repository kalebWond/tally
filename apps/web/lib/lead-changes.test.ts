import { describe, expect, it } from 'vitest';
import { bucketMinutes, cumulative, leadChanges, type MinuteCount } from './lead-changes';

const M = 60_000;
const at = (minute: number, code: string, votes: number): MinuteCount => ({
  minute: minute * M,
  code,
  votes,
});

describe('leadChanges', () => {
  it('records the first leader and every overtake, with the margin at that minute', () => {
    const changes = leadChanges([
      at(0, 'C1', 10),
      at(0, 'C2', 4),
      at(1, 'C1', 1),
      at(1, 'C2', 9), // C2 13 vs C1 11: overtake
      at(2, 'C1', 5),
      at(2, 'C2', 0), // C1 16 vs C2 13: back
    ]);
    expect(changes).toEqual([
      { minute: 0, leader: 'C1', previous: null, total: 10, margin: 6 },
      { minute: M, leader: 'C2', previous: 'C1', total: 13, margin: 2 },
      { minute: 2 * M, leader: 'C1', previous: 'C2', total: 16, margin: 3 },
    ]);
  });

  it('a tie is not a lead change: the incumbent keeps it until someone is strictly ahead', () => {
    const changes = leadChanges([at(0, 'C1', 5), at(1, 'C2', 5), at(2, 'C2', 1)]);
    expect(changes.map((c) => [c.minute / M, c.leader])).toEqual([
      [0, 'C1'],
      [2, 'C2'],
    ]);
  });

  it('ignores minutes before anyone has a vote, and handles minutes arriving out of order', () => {
    expect(
      leadChanges([at(3, 'C2', 2), at(1, 'C1', 0), at(2, 'C1', 1)]).map((c) => c.leader),
    ).toEqual(['C1', 'C2']);
  });
});

describe('cumulative', () => {
  it("carries each code's running total through minutes where it got nothing", () => {
    expect(cumulative([at(0, 'C1', 2), at(1, 'C2', 3), at(2, 'C1', 1)])).toEqual([
      { minute: 0, totals: { C1: 2 } },
      { minute: M, totals: { C1: 2, C2: 3 } },
      { minute: 2 * M, totals: { C1: 3, C2: 3 } },
    ]);
  });
});

describe('bucketMinutes', () => {
  it('picks the smallest readable bucket that keeps the chart to about 120 bars', () => {
    expect(bucketMinutes(60)).toBe(1);
    expect(bucketMinutes(366)).toBe(5);
    expect(bucketMinutes(24 * 60)).toBe(15);
    expect(bucketMinutes(30 * 24 * 60)).toBe(720);
  });
});
