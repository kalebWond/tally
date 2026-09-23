'use client';

import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { COUNTER_SPRING } from '@/lib/counter-spring';

const format = (n: number) => Math.round(n).toLocaleString('en');

interface Props {
  /** The latest absolute total. Each new value retargets the running spring. */
  value: number;
  className?: string;
  'data-testid'?: string;
}

/**
 * A counter that springs toward `value`. When `value` changes mid-animation, the same spring is
 * retargeted with its current velocity, never restarted, so updates arriving faster than the
 * animation settles read as one continuous climb instead of a stutter per update.
 *
 * Mounts at `value` (no count-up from zero on first paint). Renders through a MotionValue,
 * so animation frames update the DOM text without re-rendering React.
 */
export function AnimatedNumber({ value, className, ...rest }: Props) {
  const reduceMotion = useReducedMotion();
  const spring = useSpring(value, COUNTER_SPRING);
  const text = useTransform(spring, format);

  useEffect(() => {
    if (reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [value, reduceMotion, spring]);

  return (
    <motion.span className={className} data-target={value} data-testid={rest['data-testid']}>
      {text}
    </motion.span>
  );
}
