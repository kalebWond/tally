import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp(config);

await app.listen({ host: '0.0.0.0', port: config.PORT });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    await app.close();
    process.exit(0);
  });
}
