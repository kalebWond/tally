import { describe, expect, it } from 'vitest';
import { backlogParts, timeLeft } from './backlog-text';

// The page renders "Counting <pending> <rest>", with the number animated between the pieces.
describe('backlogParts', () => {
  it('says how many are queued and roughly how long', () => {
    expect(backlogParts({ pending: 12_345, perSec: 1500, etaSec: 9 })).toEqual({
      pending: 12_345,
      rest: 'queued votes · about 9 s',
    });
    expect(backlogParts({ pending: 1, perSec: 900, etaSec: 1 })?.rest).toBe(
      'queued vote · about 1 s',
    );
  });

  it('drops the estimate when nothing is being counted, and hides when empty or unknown', () => {
    expect(backlogParts({ pending: 40, perSec: 0, etaSec: null })?.rest).toBe('queued votes');
    expect(backlogParts({ pending: 0, perSec: 0, etaSec: 0 })).toBeNull();
    expect(backlogParts(null)).toBeNull();
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
