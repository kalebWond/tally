import type { LiveBacklog } from './live.ts';

/** Fields older than this are treated as missing: the consumer that wrote them has gone quiet. */
export const BACKLOG_STALE_MS = 5000;

/**
 * Reads the `tally:backlog` hash (F29) into a LiveBacklog. Partition lags and consumer rates are
 * summed, so several consumer replicas, each writing its own partitions, add up. Null when no
 * consumer has reported within BACKLOG_STALE_MS.
 */
export function parseBacklog(hash: Record<string, string>, now: number): LiveBacklog {
  const updatedAt = Number(hash.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt > BACKLOG_STALE_MS) return null;

  let pending = 0;
  let perSec = 0;
  let partitions = 0;
  for (const [field, raw] of Object.entries(hash)) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    if (field.startsWith('lag:')) {
      pending += value;
      partitions++;
    } else if (field.startsWith('rate:')) perSec += value;
  }
  if (partitions === 0) return null;
  perSec = Math.round(perSec);
  return {
    pending,
    perSec,
    etaSec: pending === 0 ? 0 : perSec > 0 ? Math.ceil(pending / perSec) : null,
  };
}
