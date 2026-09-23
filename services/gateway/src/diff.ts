import type { LiveTotal } from '@tally/contracts';

/** Contestants whose total differs from the previous read (or is new), as absolute totals. */
export function diffTotals(prev: Map<string, number>, next: Map<string, number>): LiveTotal[] {
  const changed: LiveTotal[] = [];
  for (const [contestantId, total] of next) {
    if (prev.get(contestantId) !== total) changed.push({ contestantId, total });
  }
  return changed;
}
