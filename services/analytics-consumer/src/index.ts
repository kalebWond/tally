import { createServer } from 'node:http';
import { createClient } from '@clickhouse/client';
import { type HealthResponse, TOPICS } from '@tally/contracts';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createAnalyticsConsumer } from './consumer.js';
import { migrate } from './schema.js';

/** Its own group: separate offsets from `tally-consumer`, so neither can hold the other back. */
const GROUP_ID = 'tally-analytics';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const clickhouse = createClient({
  url: config.CLICKHOUSE_URL,
  username: config.CLICKHOUSE_USER,
  password: config.CLICKHOUSE_PASSWORD,
  database: config.CLICKHOUSE_DB,
  request_timeout: 30_000,
});
const consumer = createAnalyticsConsumer({
  brokers: config.KAFKA_BROKERS,
  topics: [TOPICS.raw, TOPICS.dead],
  groupId: GROUP_ID,
  clickhouse,
  log,
});

const within = <T>(p: Promise<T>, ms = 1000) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(reject, ms).unref())]);

const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }
  void (async () => {
    const [redpanda, ch] = await Promise.all([
      consumer.isReady(),
      within(clickhouse.ping()).then(
        (r) => r.success,
        () => false,
      ),
    ]);
    const ok = redpanda && ch;
    const body: HealthResponse = {
      status: ok ? 'ok' : 'degraded',
      service: 'analytics-consumer',
      redpanda: redpanda ? 'connected' : 'disconnected',
      clickhouse: ch ? 'connected' : 'disconnected',
    };
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  })();
});
server.listen(config.PORT, '0.0.0.0', () =>
  log.info({ port: config.PORT }, 'analytics consumer listening'),
);

await migrate(clickhouse, log);
await consumer.start();
log.info({ topics: [TOPICS.raw, TOPICS.dead], group: GROUP_ID }, 'consuming');
const statsTimer = setInterval(() => log.info(consumer.stats(), 'progress'), 30_000);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 15_000).unref();
    clearInterval(statsTimer);
    await consumer.stop(); // finish and commit the in-flight batch
    server.close();
    await clickhouse.close();
    log.info(consumer.stats(), 'stopped');
    process.exit(0);
  });
}
