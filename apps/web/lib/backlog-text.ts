import type { LiveBacklog } from '@tally/contracts';

/** "about 8 s", "about 3 min"; null when there's no estimate (nothing being counted). */
export function timeLeft(etaSec: number | null) {
  if (etaSec === null) return null;
  if (etaSec < 60) return `about ${Math.max(etaSec, 1)} s`;
  return `about ${Math.round(etaSec / 60)} min`;
}

/**
 * The results page's counting line (F29), "Counting 1,234 queued votes · about 8 s", in two
 * pieces: the page animates the number between them (F31). "Queued" rather than "for this
 * contest": the queue is shared by every contest. Null when nothing is waiting or nobody knows.
 */
export function backlogParts(backlog: LiveBacklog) {
  if (!backlog || backlog.pending === 0) return null;
  const votes = `queued ${backlog.pending === 1 ? 'vote' : 'votes'}`;
  const left = timeLeft(backlog.etaSec);
  return { pending: backlog.pending, rest: left ? `${votes} · ${left}` : votes };
}
