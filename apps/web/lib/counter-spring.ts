/**
 * Spring for vote counters. Slightly overdamped (damping ratio ≈ 1.1: critical would be
 * 2·√(stiffness·mass) ≈ 23.7), so a count approaches its target without ever overshooting.
 * An underdamped spring would briefly show more votes than exist, then count backwards.
 * Settles in about 0.4 s, which keeps up with the gateway's 250 ms updates without lagging
 * far behind. Checked by counter-spring.test.ts.
 */
export const COUNTER_SPRING = { stiffness: 140, damping: 26, mass: 1 };
