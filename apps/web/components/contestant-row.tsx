'use client';

import {
  AnimatePresence,
  type MotionStyle,
  motion,
  useReducedMotion,
  type Variants,
} from 'motion/react';
import Image from 'next/image';
import { memo, useEffect, useRef, useState } from 'react';
import { flagEmoji } from '@/lib/flag';
import { BURST_GAP_MS, type BurstState, nextBurst } from '@/lib/liveliness';
import { SMOOTH, SNAPPY } from '@/lib/motion';
import type { Movement } from '@/lib/movement';
import type { Standing } from '@/lib/standings';
import { AnimatedNumber } from './animated-number';

const DEFAULT_FROM = '#4B5563';
const DEFAULT_TO = '#1F2937';

/** The leader highlight's handover takes as long as the glide it happens during. */
const HANDOFF = { duration: 0.45, ease: 'easeOut' } as const;

/** How much a row grows while it overtakes: enough to read as lifted, not enough to blur text. */
const LIFT_SCALE = 1.02;

export type Layout = 'list' | 'grid';

interface Props {
  standing: Standing;
  /** List row or grid card: the same element and children either way, arranged by CSS (F24). */
  layout: Layout;
  /** Its place in the standings: a change is what makes the row measure itself and glide. */
  index: number;
  leader: boolean;
  /**
   * On the podium (F39): one of the first three places, with at least one vote. The value is the
   * medal, from its rank (gold, silver, bronze), so a tie shares a medal.
   */
  podium?: 1 | 2 | 3 | undefined;
  /** Before the first snapshot the total is unknown, so show a dash rather than a false zero. */
  synced: boolean;
  /** Set briefly after an overtake: a rising row lifts above the rows it passes. */
  movement?: Movement | undefined;
}

/**
 * One contestant in the standings, as a list row or a grid card. Keyed by contestant id by its
 * parent, which is what lets the layout animation follow it across reorders.
 *
 * The layout flag changes only an attribute: the element tree is identical in both layouts and
 * CSS arranges it. Switching therefore never remounts anything, so the counter's spring, the
 * overtake treatment and the live feed carry straight on (CLAUDE.md: one component, two layouts).
 */
export function ContestantRow(props: Props) {
  const { standing, layout, index, leader, podium, synced, movement } = props;
  const from = standing.accentFrom ?? DEFAULT_FROM;
  const to = standing.accentTo ?? DEFAULT_TO;
  // Reduced motion: no lift (Motion would otherwise jump the scale rather than skip it).
  const reduce = useReducedMotion();
  const lift = movement === 'up' && !reduce;
  // What the row's measurements depend on: its arrangement, its place and whether it stands on
  // the podium (which sizes it). Its parts measure with it (F32): a part that kept an old
  // measurement while the row re-measured was placed relative to the row from where it used to
  // be, and could stay a slot away from its panel.
  const place = `${layout}:${index}:${podium ?? 0}`;

  return (
    <motion.li
      layout
      // Measures itself only when its place or the arrangement changes, not on every update.
      layoutDependency={place}
      transition={SMOOTH}
      // The lift (F31): a rising row grows slightly while it passes, then settles.
      animate={{ scale: lift ? LIFT_SCALE : 1 }}
      className="row"
      data-layout={layout}
      data-leader={leader || undefined}
      data-podium={podium}
      data-rising={movement === 'up' || undefined}
      data-moved={movement ? true : undefined}
      data-code={standing.code}
      style={
        {
          '--accent-from': from,
          '--accent-to': to,
          zIndex: movement === 'up' ? 2 : movement === 'down' ? 0 : 1,
        } as MotionStyle
      }
    >
      <Glow leader={leader} />
      <Rank rank={standing.rank} place={place} />
      <Identity
        name={standing.name}
        code={standing.code}
        imageUrl={standing.imageUrl}
        countryCode={standing.countryCode}
        place={place}
      />
      <motion.span layout="position" layoutDependency={place} className="row-score">
        {synced ? (
          <>
            <AnimatedNumber
              className="row-total"
              value={standing.total}
              data-testid={`total-${standing.code}`}
            />
            <VoteBurst total={standing.total} />
          </>
        ) : (
          <span className="row-total">–</span>
        )}
      </motion.span>
    </motion.li>
  );
}

/*
 * The parts below are memoised: the row re-renders on every totals update (4 a second), but
 * only its score changes, so these skip the work unless their own props change. `place` is the
 * row's arrangement and position: parts measure their own boxes only when it changes, which is
 * what makes a row reshape into its card (and not stretch its text) on List ↔ Grid, and keeps
 * them in step with the row when it moves.
 */

/**
 * The leader's highlight, handed over during an overtake: it fades in on the new leader as it
 * glides up into first place, and out on the old one as it drops. It moves with its row, so it
 * can never jump.
 */
const Glow = memo(function Glow({ leader }: { leader: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {leader && (
        <motion.span
          className="row-glow"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: HANDOFF }}
          exit={{ opacity: 0, transition: HANDOFF }}
        />
      )}
    </AnimatePresence>
  );
});

const Rank = memo(function Rank({ rank, place }: { rank: number; place: string }) {
  return (
    <motion.span layout="position" layoutDependency={place} className="row-rank">
      <span className="sr-only">Rank </span>
      <RankRoll rank={rank} />
    </motion.span>
  );
});

const Identity = memo(function Identity(props: {
  name: string;
  code: string;
  imageUrl: string | null;
  countryCode: string | null;
  place: string;
}) {
  const { name, code, imageUrl, countryCode, place } = props;
  const flag = flagEmoji(countryCode);
  return (
    <>
      <motion.span layout layoutDependency={place} className="row-stripe" aria-hidden="true" />
      <motion.span layout layoutDependency={place} className="row-avatar" aria-hidden="true">
        {imageUrl && (
          // Generated SVG avatars: nothing for the optimiser to do, so serve them as-is.
          <Image src={imageUrl} alt="" width={104} height={104} unoptimized />
        )}
      </motion.span>
      <motion.span layout="position" layoutDependency={place} className="row-who">
        <span className="row-name">{name}</span>
        <span className="row-meta">
          <span className="row-code">{code}</span>
          {countryCode && (
            <span className="row-country">
              {flag && (
                <span className="row-flag" aria-hidden="true">
                  {flag}
                </span>
              )}
              {countryCode}
            </span>
          )}
        </span>
      </motion.span>
    </>
  );
});

const ROLL: Variants = {
  enter: (up: boolean) => ({ y: up ? '90%' : '-90%', opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (up: boolean) => ({ y: up ? '-90%' : '90%', opacity: 0 }),
};

/**
 * The rank, rolling like an odometer when it changes: moving up, the new number rises in from
 * below and the old one leaves upward; moving down, the reverse.
 */
function RankRoll({ rank }: { rank: number }) {
  const [last, setLast] = useState(rank);
  const [up, setUp] = useState(true);
  if (rank !== last) {
    setLast(rank);
    setUp(rank < last);
  }
  return (
    <span className="row-rank-roll">
      <AnimatePresence initial={false} mode="popLayout" custom={up}>
        <motion.span
          key={rank}
          custom={up}
          variants={ROLL}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SNAPPY}
        >
          {rank}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const plus = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * "+128" floating up from a total as votes arrive: at most one per BURST_GAP_MS, with gains in
 * between added to the next, so a busy row pulses steadily instead of fizzing. A gain that lands
 * inside the gap is shown when the gap ends, even if no further frame arrives.
 */
function VoteBurst({ total }: { total: number }) {
  const state = useRef<BurstState | null>(null);
  const latest = useRef(total);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [burst, setBurst] = useState<{ id: number; amount: number } | null>(null);

  useEffect(() => {
    latest.current = total;
    const run = () => {
      timer.current = undefined;
      const r = nextBurst(state.current, latest.current, performance.now());
      state.current = r.state;
      if (r.burst !== null) {
        const amount = r.burst;
        setBurst((b) => ({ id: (b?.id ?? 0) + 1, amount }));
      } else if (r.pending && timer.current === undefined) {
        timer.current = setTimeout(run, Math.max(0, r.state.at + BURST_GAP_MS - performance.now()));
      }
    };
    if (timer.current === undefined) run();
  }, [total]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!burst) return null;
  return (
    <span key={burst.id} className="row-burst" aria-hidden="true">
      +{plus.format(burst.amount)}
    </span>
  );
}
