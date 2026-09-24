import { redisKeys } from '@tally/contracts';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** Seconds each field lives after it's written: a stopped consumer's fields vanish by then. */
export const BACKLOG_FIELD_TTL_S = 10;

interface BacklogReporterOptions {
  /** Lag per partition of the topic; negative for partitions this consumer isn't assigned. */
  getLag: () => Promise<bigint[]>;
  /** Messages this consumer has processed and committed so far. */
  processed: () => number;
  redis: Pick<Redis, 'multi'>;
  /** Unique per consumer process, so replicas' rate fields don't overwrite each other. */
  instanceId: string;
  log: Pick<Logger, 'warn'>;
  intervalMs?: number;
  /** The rate is averaged over this window. */
  rateWindowMs?: number;
  now?: () => number;
}

/**
 * Publishes how many votes are accepted but not yet counted (F29). Offsets are committed only
 * after a batch is in Postgres and Redis, so the consumer's lag is exactly that number. Each
 * consumer writes only the partitions it owns, plus its own rate, into `tally:backlog`; readers
 * sum them (`parseBacklog`). Failures are logged and skipped: counting never waits on this.
 */
export function createBacklogReporter(opts: BacklogReporterOptions) {
  const { redis, instanceId, log, intervalMs = 1000, rateWindowMs = 5000 } = opts;
  const now = opts.now ?? Date.now;
  const samples: [number, number][] = [];
  let timer: NodeJS.Timeout | undefined;

  function rate(t: number) {
    samples.push([t, opts.processed()]);
    while (samples.length > 2 && t - (samples[1]?.[0] ?? t) >= rateWindowMs) samples.shift();
    const [t0, p0] = samples[0] ?? [t, 0];
    const [t1, p1] = samples[samples.length - 1] ?? [t, 0];
    return t1 > t0 ? ((p1 - p0) * 1000) / (t1 - t0) : 0;
  }

  async function report() {
    const t = now();
    const perSec = rate(t);
    const lags = await opts.getLag();
    const fields: Record<string, string> = {};
    lags.forEach((lag, partition) => {
      if (lag >= 0n) fields[`lag:${partition}`] = lag.toString();
    });
    // Not assigned any partitions yet (still joining the group): say nothing rather than "0".
    if (Object.keys(fields).length === 0) return false;
    fields[`rate:${instanceId}`] = perSec.toFixed(1);
    fields.updatedAt = String(t);
    const names = Object.keys(fields);
    await redis
      .multi()
      .hset(redisKeys.backlog, fields)
      .hexpire(redisKeys.backlog, BACKLOG_FIELD_TTL_S, 'FIELDS', names.length, ...names)
      .exec();
    return true;
  }

  return {
    report,
    start() {
      timer = setInterval(() => {
        report().catch((err) => log.warn({ err }, 'backlog report failed'));
      }, intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
