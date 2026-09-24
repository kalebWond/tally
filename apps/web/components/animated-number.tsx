'use client';

import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { COUNTER_SPRING } from '@/lib/counter-spring';

/**
 * One formatter per precision, made once: this runs every frame for every counter, and
 * `toLocaleString` with options builds a new `Intl.NumberFormat` on every call.
 */
const formats = new Map<number, Intl.NumberFormat>();
function formatter(digits: number) {
  let f = formats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('en', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formats.set(digits, f);
  }
  return f;
}

interface Props {
  /** The latest absolute total. Each new value retargets the running spring. */
  value: number;
  /** Decimal places shown (the control panel's latencies); whole numbers by default. */
  digits?: number;
  /** Appended to the number: " ms", "/s". */
  unit?: string;
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
export function AnimatedNumber({ value, digits = 0, unit = '', className, ...rest }: Props) {
  const reduceMotion = useReducedMotion();
  const spring = useSpring(value, COUNTER_SPRING);
  const text = useTransform(
    spring,
    (n) => `${formatter(digits).format(digits ? n : Math.round(n))}${unit}`,
  );

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
