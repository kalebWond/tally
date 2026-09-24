import type { LiveBacklog } from '@tally/contracts';

const n = new Intl.NumberFormat('en');

/** "about 8 s", "about 3 min"; null when there's no estimate (nothing being counted). */
export function timeLeft(etaSec: number | null) {
  if (etaSec === null) return null;
  if (etaSec < 60) return `about ${Math.max(etaSec, 1)} s`;
  return `about ${Math.round(etaSec / 60)} min`;
}

/**
 * The results page's counting line (F29) in pieces, so the page can animate the number (F31):
 * null when nothing is waiting or nobody knows.
 */
export function backlogParts(backlog: LiveBacklog) {
  if (!backlog || backlog.pending === 0) return null;
  return {
    pending: backlog.pending,
    noun: backlog.pending === 1 ? 'vote' : 'votes',
    left: timeLeft(backlog.etaSec),
  };
}

/**
 * The counting line as text. "Queued" rather than "for this contest": the queue is shared by
 * every contest.
 */
export function backlogLine(backlog: LiveBacklog) {
  const parts = backlogParts(backlog);
  if (!parts) return null;
  const votes = `Counting ${n.format(parts.pending)} queued ${parts.noun}`;
  return parts.left ? `${votes} · ${parts.left}` : votes;
}
