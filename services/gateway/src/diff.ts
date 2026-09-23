import type { LiveMinute, LiveTotal } from '@tally/contracts';

/** Contestants whose total differs from the previous read (or is new), as absolute totals. */
export function diffTotals(prev: Map<string, number>, next: Map<string, number>): LiveTotal[] {
  const changed: LiveTotal[] = [];
  for (const [contestantId, total] of next) {
    if (prev.get(contestantId) !== total) changed.push({ contestantId, total });
  }
  return changed;
}

/** Minutes whose count differs from the previous read (or entered the window), as absolute counts. */
export function diffMinutes(prev: Map<number, number>, next: Map<number, number>): LiveMinute[] {
  const changed: LiveMinute[] = [];
  for (const [minute, count] of next) {
    if (prev.get(minute) !== count) changed.push({ minute, count });
  }
  return changed;
}
