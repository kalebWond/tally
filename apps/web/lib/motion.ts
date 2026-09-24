import type { Transition } from 'motion/react';

/**
 * Motion presets (F31). Every animation in the app uses one of these, so the whole UI moves
 * alike. Springs are critically damped (no bounce): nothing here is thrown by a gesture, so
 * nothing has momentum to overshoot with. `visualDuration` is roughly Apple's "response": the
 * time to visibly arrive. Springs start from the current on-screen value, so a new target
 * mid-flight redirects the motion instead of restarting it.
 *
 * CSS-only transitions use the same curve: `--ease-spring` with `--dur-snappy` / `--dur-smooth`
 * in globals.css.
 */

/** Presses, toggles, pills, small state changes. */
export const SNAPPY: Transition = { type: 'spring', bounce: 0, visualDuration: 0.25 };

/** Layout: reorders, List ↔ Grid, sliding highlights, bars. */
export const SMOOTH: Transition = { type: 'spring', bounce: 0, visualDuration: 0.4 };

/** Things arriving: dialogs, rows, cards. */
export const GENTLE: Transition = { type: 'spring', bounce: 0, visualDuration: 0.45 };

/** Leaving is quicker than arriving: the eye has already moved on. */
export const EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 1, 1] };

/** Delay between rows of a list that arrives together (sample contestants). */
export const STAGGER_S = 0.03;

/**
 * A message arriving under what caused it (a notice, a field's error): it drops in a few pixels
 * and fades up, and leaves the same way, faster. Spread onto a motion element.
 */
export const APPEAR = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: GENTLE },
  exit: { opacity: 0, y: -4, transition: EXIT },
} as const;

/**
 * A notice joining a page's column (a flex column with gap-6): it opens to its own height as it
 * fades in, so what's below slides down instead of jumping, and closes the same way. The
 * negative margin cancels the column's gap while it's closed (a flex gap only: a grid track
 * can't shrink below zero, so in a grid the gap would still appear at once). Spread onto a
 * wrapper with overflow hidden.
 */
export const EXPAND = {
  initial: { opacity: 0, height: 0, marginBottom: '-1.5rem' },
  animate: { opacity: 1, height: 'auto', marginBottom: '0rem', transition: GENTLE },
  exit: { opacity: 0, height: 0, marginBottom: '-1.5rem', transition: EXIT },
} as const;
