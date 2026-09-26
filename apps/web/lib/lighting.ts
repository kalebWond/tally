import type { ContestStatus } from '@tally/contracts';

/**
 * The results board's stage lighting (F32): what the searchlights and the LED wall do, cued by
 * the contest rather than looping. Pure, so the timing rules are tested; `components/stage`
 * turns the cue into motion.
 */

/** A lead must hold this long before the stage takes the new leader's colours. */
export const STAGE_HOLD_MS = 3000;
/** At most one lead-change spotlight this often: a close race would otherwise never let go. */
export const CUE_GAP_MS = 8000;
/** A lead-change spotlight: the swing to the new leader (under a second) and the hold. */
export const SPOTLIGHT_MS = 2400;

/**
 * - `dark`: the contest hasn't opened; beams off.
 * - `live`: voting, or closed with votes still being counted; the beams sway at a tempo set by
 *   the vote rate.
 * - `spotlight`: the lead just changed; both beams cross on the new leader, then sway again.
 * - `finale`: closed and counted (F39): the beams wander, and confetti falls if this page saw it.
 */
export type Cue = 'dark' | 'live' | 'spotlight' | 'finale';

export interface Lighting {
  /** The contest status last seen; null until the first reading. */
  status: ContestStatus | null;
  /** Who leads now: first place with at least one vote. */
  leader: string | null;
  /** When `leader` took the lead. */
  since: number;
  /** Whose colours the stage shows: the leader, once the lead has held. */
  shown: string | null;
  spotlight: { target: string; until: number } | null;
  lastCueAt: number;
  /**
   * After the close (F39): `counting` while votes accepted before it are still being counted;
   * then `live` when this page sees the last one counted (the finale plays), or `settled` when
   * it loaded with everything already counted (the finale is shown, not played).
   */
  finale: 'none' | 'counting' | 'live' | 'settled';
}

export const initialLighting: Lighting = {
  status: null,
  leader: null,
  since: 0,
  shown: null,
  spotlight: null,
  lastCueAt: Number.NEGATIVE_INFINITY,
  finale: 'none',
};

/**
 * The next lighting state, given the contest's status, who is in first place (ids of the
 * contestants ranked first with at least one vote, in board order), and whether the counting
 * queue is empty. Safe to call again with the same input: a hold or a spotlight that ran out by
 * `now` is applied then.
 *
 * `counted` comes from the backlog, which covers every contest: it assumes one contest votes at
 * a time, as the generator drives one. With two, one's finale would wait for the other's queue.
 */
export function advance(
  prev: Lighting,
  input: { status: ContestStatus; leaders: readonly string[]; counted: boolean },
  now: number,
): Lighting {
  const { status, leaders, counted } = input;
  const leader = leaders[0] ?? null;

  // The first reading sets the scene as it is: no hold, no spotlight. A contest found closed and
  // counted shows its finale; one still counting plays it when the counting ends.
  if (prev.status === null) {
    return {
      ...initialLighting,
      status,
      leader,
      since: now,
      shown: leader,
      finale: status !== 'closed' ? 'none' : counted ? 'settled' : 'counting',
    };
  }

  const next: Lighting = { ...prev, status, leader };
  // Votes still being counted after the close can change the lead: it's still a race.
  const racing = status === 'open' || (status === 'closed' && prev.finale === 'counting');

  if (leader !== prev.leader) {
    next.since = now;
    const active = prev.spotlight && now < prev.spotlight.until;
    if (racing && prev.leader !== null && leader !== null) {
      if (active && prev.spotlight) {
        // Mid-swing: the beams turn toward the newest leader, on the same cue.
        next.spotlight = { ...prev.spotlight, target: leader };
      } else if (now - prev.lastCueAt >= CUE_GAP_MS) {
        next.spotlight = { target: leader, until: now + SPOTLIGHT_MS };
        next.lastCueAt = now;
      }
    }
  }

  if (status !== 'closed') {
    next.finale = 'none';
  } else if (prev.status !== 'closed' || prev.finale === 'counting') {
    // Voting closed while the page watched. The finale plays, in the winner's colours, once
    // the last vote accepted before the close is counted: only then is the winner known.
    if (counted) {
      next.finale = 'live';
      next.shown = leader;
      next.spotlight = null;
    } else {
      next.finale = 'counting';
    }
  }

  if (next.leader !== next.shown && now - next.since >= STAGE_HOLD_MS) next.shown = next.leader;
  if (next.spotlight && now >= next.spotlight.until) next.spotlight = null;
  return next;
}

export function cueOf(l: Lighting): Cue {
  if (l.status === 'closed' && l.finale !== 'counting') return 'finale';
  if (l.status !== 'open' && l.status !== 'closed') return 'dark';
  return l.spotlight ? 'spotlight' : 'live';
}

/**
 * When the lighting would next change without any new reading (a hold completing, a spotlight
 * ending), so the caller can advance it then; null when nothing is pending.
 */
export function nextChangeAt(l: Lighting): number | null {
  const times: number[] = [];
  if (l.leader !== l.shown) times.push(l.since + STAGE_HOLD_MS);
  if (l.spotlight) times.push(l.spotlight.until);
  return times.length ? Math.min(...times) : null;
}

/**
 * The angle, in degrees clockwise from straight up, that points a beam from `origin` at
 * `target` (screen coordinates: y grows downward).
 */
export function aimAngle(
  origin: { x: number; y: number },
  target: { x: number; y: number },
): number {
  return (Math.atan2(target.x - origin.x, origin.y - target.y) * 180) / Math.PI;
}

const QUIET_SWAY_S = 36;
const BUSY_SWAY_S = 3;
const BUSY_RATE = 5000;

/**
 * One full sway of the beams, in seconds: 36 s when nothing arrives (a drift of about a degree a
 * second, nearly still), quickening on a log scale to 3 s at 5,000 votes/s, like the LIVE dot's
 * beat.
 */
export function swayPeriod(perSec: number): number {
  if (perSec <= 1) return QUIET_SWAY_S;
  const t = Math.min(1, Math.log(perSec) / Math.log(BUSY_RATE));
  return QUIET_SWAY_S * (BUSY_SWAY_S / QUIET_SWAY_S) ** t;
}
