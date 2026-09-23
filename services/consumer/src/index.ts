import { TOPICS } from '@tally/contracts';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createVoteConsumer } from './consumer.js';
import { createHealthServer } from './health.js';

/** Totals consumer group. Offsets, lag and (later) KEDA scaling are tracked under this name. */
const GROUP_ID = 'tally-consumer';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const { db, close: closeDb } = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
const consumer = createVoteConsumer({
  brokers: config.KAFKA_BROKERS,
  topic: TOPICS.raw,
  groupId: GROUP_ID,
  db,
  redis,
  log,
});

const within = <T>(p: Promise<T>, ms = 1000) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(reject, ms).unref())]);
const probe = (p: () => Promise<unknown>) =>
  within(p()).then(
    () => 'connected' as const,
    () => 'disconnected' as const,
  );

const server = createHealthServer(async () => ({
  redpanda: (await consumer.isReady()) ? 'connected' : 'disconnected',
  postgres: await probe(() => db.execute(sql`select 1`)),
  redis: await probe(() => redis.ping()),
}));
server.listen(config.PORT, '0.0.0.0', () => log.info({ port: config.PORT }, 'consumer listening'));

await consumer.start();
log.info({ topic: TOPICS.raw, group: GROUP_ID }, 'consuming');

const statsTimer = setInterval(() => log.info(consumer.stats(), 'progress'), 30_000);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 15_000).unref();
    clearInterval(statsTimer);
    // Finish and commit the in-flight batch before closing the stores it writes to.
    await consumer.stop();
    server.close();
    redis.disconnect();
    await closeDb();
    log.info(consumer.stats(), 'stopped');
    process.exit(0);
  });
}
