import { LiveCloseCodes } from '@tally/contracts';

const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 10_000;

/**
 * Exponential backoff with jitter in the upper half of each step (0.25–0.5 s, 0.5–1 s, 1–2 s …,
 * capped at 10 s). The jitter matters when a gateway restarts under many viewers: without it,
 * every screen reconnects in the same instant. The floor keeps a down gateway from being
 * hammered by near-zero delays.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempt, 20));
  return step / 2 + random() * (step / 2);
}

export type ClosePlan = { retry: false } | { retry: true; delayMs: number };

/** What to do after the socket closed with `code`, given how many retries already failed. */
export function afterClose(
  code: number,
  attempt = 0,
  random: () => number = Math.random,
): ClosePlan {
  // Reconnecting won't make a bad contest id valid.
  if (code === LiveCloseCodes.invalidContest) return { retry: false };
  // Deliberate restart: the gateway is coming straight back, so don't wait out a long backoff.
  if (code === LiveCloseCodes.goingAway) return { retry: true, delayMs: 250 + random() * 500 };
  return { retry: true, delayMs: backoffDelay(attempt, random) };
}
