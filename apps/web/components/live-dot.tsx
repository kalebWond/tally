'use client';

import { useReducedMotion } from 'motion/react';
import { type RefObject, useEffect, useRef } from 'react';
import { addTotalSample, pulsePeriod, type TotalSample, voteRate } from '@/lib/liveliness';

/** How often the beat's speed is brought up to date with the vote rate. */
const RETUNE_MS = 250;
/** How much of the gap to the new speed each retune closes: it eases over about a second. */
const FOLLOW = 0.35;

/**
 * The status pill's dot (F31). While the contest is live it beats at a speed set by the real
 * vote rate: slow when quiet, quick in a surge. The beat is a Web Animation, so it runs on the
 * compositor, not in a script every frame; only its playback rate is changed, which keeps its
 * place in the beat, so it speeds up or slows down smoothly instead of restarting. Still when
 * not live and for anyone who asked for reduced motion.
 */
export function LiveDot(props: { beating: boolean; samples: RefObject<TotalSample[]> }) {
  const { beating, samples } = props;
  const reduce = useReducedMotion();
  const dot = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = dot.current;
    if (!el || !beating || reduce) return;
    // One beat per second at playback rate 1; the rate sets the real speed.
    const beat = el.animate(
      [
        { opacity: 1, scale: 1 },
        { opacity: 0.35, scale: 0.8 },
        { opacity: 1, scale: 1 },
      ],
      { duration: 1000, iterations: Number.POSITIVE_INFINITY, easing: 'ease-in-out' },
    );
    let rate = 1 / pulsePeriod(voteRate(samples.current, performance.now()));
    beat.playbackRate = rate;
    const retune = setInterval(() => {
      const target = 1 / pulsePeriod(voteRate(samples.current, performance.now()));
      rate += (target - rate) * FOLLOW;
      beat.updatePlaybackRate(rate);
      // For checks and curious operators: the current beat, to a tenth of a second.
      el.dataset.period = (1 / rate).toFixed(1);
    }, RETUNE_MS);
    el.dataset.period = (1 / rate).toFixed(1);
    return () => {
      clearInterval(retune);
      beat.cancel();
      delete el.dataset.period;
    };
  }, [beating, reduce, samples]);

  return <span ref={dot} className="board-status-dot" aria-hidden />;
}

/**
 * Readings of the contest's total over the last few seconds, for the vote rate that sets the
 * LIVE dot's beat and the searchlights' sway. Only real readings: the jump from "unknown" to
 * the first snapshot isn't votes arriving.
 */
export function useTotalSamples(totalVotes: number, synced: boolean) {
  const samples = useRef<TotalSample[]>([]);
  useEffect(() => {
    if (!synced) return;
    samples.current = addTotalSample(samples.current, { at: performance.now(), total: totalVotes });
  }, [totalVotes, synced]);
  return samples;
}
