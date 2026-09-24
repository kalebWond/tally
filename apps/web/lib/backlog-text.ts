import type { LiveBacklog } from '@tally/contracts';

const n = new Intl.NumberFormat('en');

/** "about 8 s", "about 3 min"; null when there's no estimate (nothing being counted). */
export function timeLeft(etaSec: number | null) {
  if (etaSec === null) return null;
  if (etaSec < 60) return `about ${Math.max(etaSec, 1)} s`;
  return `about ${Math.round(etaSec / 60)} min`;
}

/**
 * The results page's counting line (F29): null when nothing is waiting or nobody knows.
 * "Queued" rather than "for this contest": the queue is shared by every contest.
 */
export function backlogLine(backlog: LiveBacklog) {
  if (!backlog || backlog.pending === 0) return null;
  const votes = `Counting ${n.format(backlog.pending)} queued ${backlog.pending === 1 ? 'vote' : 'votes'}`;
  const left = timeLeft(backlog.etaSec);
  return left ? `${votes} · ${left}` : votes;
}
