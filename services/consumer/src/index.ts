import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createHealthServer } from './health.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });

// The consumer has no public API; this listener exists for /health (and /metrics later).
const server = createHealthServer();
server.listen(config.PORT, '0.0.0.0', () => log.info({ port: config.PORT }, 'consumer listening'));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => process.exit(0));
  });
}
