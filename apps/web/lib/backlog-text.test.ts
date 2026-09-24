import { describe, expect, it } from 'vitest';
import { backlogLine, timeLeft } from './backlog-text';

describe('backlogLine', () => {
  it('says how many are queued and roughly how long', () => {
    expect(backlogLine({ pending: 12_345, perSec: 1500, etaSec: 9 })).toBe(
      'Counting 12,345 queued votes · about 9 s',
    );
    expect(backlogLine({ pending: 1, perSec: 900, etaSec: 1 })).toBe(
      'Counting 1 queued vote · about 1 s',
    );
  });

  it('drops the estimate when nothing is being counted, and hides when empty or unknown', () => {
    expect(backlogLine({ pending: 40, perSec: 0, etaSec: null })).toBe('Counting 40 queued votes');
    expect(backlogLine({ pending: 0, perSec: 0, etaSec: 0 })).toBeNull();
    expect(backlogLine(null)).toBeNull();
  });
});

describe('timeLeft', () => {
  it('uses seconds under a minute and minutes after', () => {
    expect(timeLeft(0)).toBe('about 1 s');
    expect(timeLeft(59)).toBe('about 59 s');
    expect(timeLeft(150)).toBe('about 3 min');
    expect(timeLeft(null)).toBeNull();
  });
});
