import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createGateway } from './gateway.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
const gateway = createGateway({ redis, pollMs: config.GATEWAY_POLL_MS, log });

gateway.server.listen(config.PORT, '0.0.0.0', () =>
  log.info({ port: config.PORT, pollMs: config.GATEWAY_POLL_MS }, 'gateway listening'),
);

const statsTimer = setInterval(() => log.info(gateway.stats(), 'connections'), 30_000);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    log.info({ signal, ...gateway.stats() }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    clearInterval(statsTimer);
    // Clients get close code 1001 and reconnect (F11); then Redis goes.
    await gateway.close();
    redis.disconnect();
    process.exit(0);
  });
}
