'use client';

import { type MotionStyle, motion, type Transition } from 'motion/react';
import Image from 'next/image';
import type { Movement } from '@/lib/movement';
import type { Standing } from '@/lib/standings';
import { AnimatedNumber } from './animated-number';

const DEFAULT_FROM = '#4B5563';
const DEFAULT_TO = '#1F2937';

/**
 * Reorder glide. No bounce: an overshooting spring would push a row past its slot into its
 * neighbour's and back. Interrupted mid-flight (another overtake), Motion restarts from the
 * row's current on-screen position, so rapid swaps never snap.
 */
const REORDER: Transition = { type: 'spring', bounce: 0, duration: 0.45 };

interface Props {
  standing: Standing;
  leader: boolean;
  /** Before the first snapshot the total is unknown, so show a dash rather than a false zero. */
  synced: boolean;
  /** Set briefly after an overtake: a rising row draws above the rows it passes, and glows. */
  movement?: Movement | undefined;
}

/**
 * One contestant in the standings. Keyed by contestant id by its parent, which is what lets the
 * layout animation follow it across reorders. F24's card grid reuses this component with a
 * layout flag rather than forking it.
 */
export function ContestantRow({ standing, leader, synced, movement }: Props) {
  const from = standing.accentFrom ?? DEFAULT_FROM;
  const to = standing.accentTo ?? DEFAULT_TO;

  return (
    <motion.li
      // Position only: rows never change size, so no scale distortion of text or avatars.
      layout="position"
      transition={REORDER}
      className="row"
      data-leader={leader || undefined}
      data-rising={movement === 'up' || undefined}
      data-code={standing.code}
      style={
        {
          '--accent-from': from,
          '--accent-to': to,
          zIndex: movement === 'up' ? 2 : movement === 'down' ? 0 : 1,
        } as MotionStyle
      }
    >
      <span className="row-rank">
        <span className="sr-only">Rank </span>
        {standing.rank}
      </span>
      <span className="row-stripe" aria-hidden="true" />
      {standing.imageUrl ? (
        // Generated SVG avatars: nothing for the optimiser to do, so serve them as-is.
        <Image
          className="row-avatar"
          src={standing.imageUrl}
          alt=""
          width={52}
          height={52}
          unoptimized
        />
      ) : (
        <span className="row-avatar" aria-hidden="true" />
      )}
      <span className="row-who">
        <span className="row-name">{standing.name}</span>
        <span className="row-meta">
          <span className="row-code">{standing.code}</span>
          {standing.countryCode && <span className="row-country">{standing.countryCode}</span>}
        </span>
      </span>
      {synced ? (
        <AnimatedNumber
          className="row-total"
          value={standing.total}
          data-testid={`total-${standing.code}`}
        />
      ) : (
        <span className="row-total">–</span>
      )}
    </motion.li>
  );
}
