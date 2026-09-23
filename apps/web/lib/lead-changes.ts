/** Counted votes for one code in one minute (minute = epoch ms of its start). */
export interface MinuteCount {
  minute: number;
  code: string;
  votes: number;
}

export interface LeadChange {
  minute: number;
  leader: string;
  /** Who led before; null for the first leader. */
  previous: string | null;
  /** The new leader's cumulative total and margin over the runner-up at that minute. */
  total: number;
  margin: number;
}

const natural = new Intl.Collator('en', { numeric: true }).compare;

/**
 * Walks minute by minute through cumulative totals and records every change of leader. A tie
 * doesn't change the lead: the incumbent keeps it until someone is strictly ahead (so a tie at
 * the top isn't reported as a flip-flop). Minute granularity: two changes inside one minute
 * show as whatever the minute ends with.
 */
export function leadChanges(counts: readonly MinuteCount[]): LeadChange[] {
  const byMinute = new Map<number, MinuteCount[]>();
  for (const c of counts) byMinute.set(c.minute, [...(byMinute.get(c.minute) ?? []), c]);
  const totals = new Map<string, number>();
  const changes: LeadChange[] = [];
  let leader: string | null = null;

  for (const minute of [...byMinute.keys()].sort((a, b) => a - b)) {
    for (const c of byMinute.get(minute) ?? [])
      totals.set(c.code, (totals.get(c.code) ?? 0) + c.votes);
    const ranked = [...totals].sort((a, b) => b[1] - a[1] || natural(a[0], b[0]));
    const [top, second] = ranked;
    if (!top || top[1] <= 0) continue;
    const incumbent = leader === null ? undefined : totals.get(leader);
    if (leader !== null && incumbent !== undefined && incumbent >= top[1]) continue; // still level or ahead
    if (top[0] === leader) continue;
    changes.push({
      minute,
      leader: top[0],
      previous: leader,
      total: top[1],
      margin: top[1] - (second?.[1] ?? 0),
    });
    leader = top[0];
  }
  return changes;
}

/** Cumulative totals per code at each minute that had votes, for the history chart. */
export function cumulative(
  counts: readonly MinuteCount[],
): { minute: number; totals: Record<string, number> }[] {
  const minutes = [...new Set(counts.map((c) => c.minute))].sort((a, b) => a - b);
  const running: Record<string, number> = {};
  const byMinute = new Map<number, MinuteCount[]>();
  for (const c of counts) byMinute.set(c.minute, [...(byMinute.get(c.minute) ?? []), c]);
  return minutes.map((minute) => {
    for (const c of byMinute.get(minute) ?? []) running[c.code] = (running[c.code] ?? 0) + c.votes;
    return { minute, totals: { ...running } };
  });
}

/** Bucket width in minutes so a span fits in about `maxBuckets` bars, from a readable set. */
export function bucketMinutes(spanMinutes: number, maxBuckets = 120): number {
  for (const size of [1, 2, 5, 10, 15, 30, 60, 120, 240, 720, 1440]) {
    if (spanMinutes / size <= maxBuckets) return size;
  }
  return 1440;
}
