import { describe, expect, it } from 'vitest';
import { parseBacklog } from './backlog.ts';

const NOW = 1_790_000_000_000;

describe('parseBacklog', () => {
  it('sums every partition and every consumer, so replicas add up', () => {
    expect(
      parseBacklog(
        {
          'lag:0': '1200',
          'lag:1': '800',
          'lag:2': '0',
          'rate:a': '600.4',
          'rate:b': '399.8',
          updatedAt: String(NOW - 900),
        },
        NOW,
      ),
    ).toEqual({ pending: 2000, perSec: 1000, etaSec: 2 });
  });

  it('rounds the time left up, so it never says done too early', () => {
    expect(
      parseBacklog({ 'lag:0': '1001', 'rate:a': '1000', updatedAt: String(NOW) }, NOW)?.etaSec,
    ).toBe(2);
  });

  it('is 0 s left when nothing is waiting, and unknown while nothing is being counted', () => {
    expect(parseBacklog({ 'lag:0': '0', 'rate:a': '0', updatedAt: String(NOW) }, NOW)).toEqual({
      pending: 0,
      perSec: 0,
      etaSec: 0,
    });
    expect(parseBacklog({ 'lag:0': '50', 'rate:a': '0', updatedAt: String(NOW) }, NOW)).toEqual({
      pending: 50,
      perSec: 0,
      etaSec: null,
    });
  });

  it('is unknown when no consumer reports: empty, stale, or no partitions yet', () => {
    expect(parseBacklog({}, NOW)).toBeNull();
    expect(
      parseBacklog({ 'lag:0': '5', 'rate:a': '10', updatedAt: String(NOW - 5001) }, NOW),
    ).toBeNull();
    expect(parseBacklog({ 'rate:a': '10', updatedAt: String(NOW) }, NOW)).toBeNull();
  });

  it('ignores junk values', () => {
    expect(
      parseBacklog({ 'lag:0': 'x', 'lag:1': '-3', 'lag:2': '7', updatedAt: String(NOW) }, NOW),
    ).toEqual({ pending: 7, perSec: 0, etaSec: null });
  });
});
