import { parseBacklog, redisKeys } from '@tally/contracts';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BACKLOG_FIELD_TTL_S, createBacklogReporter } from './backlog.js';

// F29: the backlog each consumer publishes must add up across replicas and vanish when they stop.

const redisEnv = process.env.REDIS_URL;
if (!redisEnv) throw new Error('REDIS_URL must be set (see .env.example)');
let redis: Redis;
beforeAll(() => {
  redis = new Redis(Object.assign(new URL(redisEnv), { pathname: '/13' }).toString());
});
beforeEach(() => redis.del(redisKeys.backlog));
afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
});

const log = { warn: () => {} };
function reporter(instanceId: string, lags: bigint[], clock: { t: number; processed: number }) {
  return createBacklogReporter({
    getLag: async () => lags,
    processed: () => clock.processed,
    redis,
    instanceId,
    log,
    now: () => clock.t,
  });
}

describe('backlog reporter', () => {
  it('writes the partitions it owns, its rate, and a timestamp, each expiring', async () => {
    const clock = { t: 1_000_000, processed: 0 };
    const r = reporter('a', [5n, -1n, 7n], clock);
    await r.report();
    clock.t += 2000;
    clock.processed += 3000;
    await r.report();

    const hash = await redis.hgetall(redisKeys.backlog);
    expect(hash).toEqual({
      'lag:0': '5',
      'lag:2': '7',
      'rate:a': '1500.0',
      updatedAt: String(clock.t),
    });
    const ttls = await redis.httl(
      redisKeys.backlog,
      'FIELDS',
      4,
      'lag:0',
      'lag:2',
      'rate:a',
      'updatedAt',
    );
    for (const ttl of ttls) {
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(BACKLOG_FIELD_TTL_S);
    }
    expect(parseBacklog(hash, clock.t)).toEqual({ pending: 12, perSec: 1500, etaSec: 1 });
  });

  it('adds up across two consumers that split the partitions', async () => {
    const clock = { t: 2_000_000, processed: 0 };
    await reporter('a', [100n, 200n, -1n, -1n], clock).report();
    await reporter('b', [-1n, -1n, 300n, 400n], clock).report();
    expect(parseBacklog(await redis.hgetall(redisKeys.backlog), clock.t)?.pending).toBe(1000);
  });

  it('writes nothing before the consumer owns any partition, rather than claiming 0', async () => {
    expect(await reporter('a', [-1n, -1n], { t: 3_000_000, processed: 0 }).report()).toBe(false);
    expect(await redis.exists(redisKeys.backlog)).toBe(0);
  });

  it('averages the rate over its window, forgetting older samples', async () => {
    const clock = { t: 4_000_000, processed: 0 };
    const r = createBacklogReporter({
      getLag: async () => [1n],
      processed: () => clock.processed,
      redis,
      instanceId: 'a',
      log,
      now: () => clock.t,
      rateWindowMs: 5000,
    });
    // 10 s at 100/s, then 5 s at 1,000/s: the rate should reflect the recent 1,000/s.
    const step = async (count: number) => {
      await r.report();
      clock.t += 1000;
      clock.processed += count;
    };
    for (let i = 0; i < 10; i++) await step(100);
    for (let i = 0; i < 6; i++) await step(1000);
    expect(Number(await redis.hget(redisKeys.backlog, 'rate:a'))).toBeGreaterThan(800);
  });
});
