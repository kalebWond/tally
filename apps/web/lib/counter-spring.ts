/**
 * Spring for vote counters. Response 0.4 s (F31: the app's `SMOOTH` preset; was 0.53 s), so a
 * count trails the gateway's 250 ms updates less. Slightly overdamped (damping ratio ≈ 1.1:
 * critical would be 2·√(stiffness·mass) ≈ 31.4), so a count approaches its target without ever
 * overshooting. An underdamped spring would briefly show more votes than exist, then count
 * backwards. Checked by counter-spring.test.ts.
 */
export const COUNTER_SPRING = { stiffness: 247, damping: 34.6, mass: 1 };
