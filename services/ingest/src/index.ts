import { TOPICS } from '@tally/contracts';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createKafkaPublisher } from './kafka-publisher.js';

const config = loadConfig();
const publisher = createKafkaPublisher({ brokers: config.KAFKA_BROKERS, topic: TOPICS.raw });
const app = buildApp({ config, publisher, isReady: () => publisher.isReady() });

await app.listen({ host: '0.0.0.0', port: config.PORT });

// Don't exit if the broker is down at boot: /health reports it and publishes return 503.
if (!(await publisher.isReady(5000))) {
  app.log.warn({ topic: TOPICS.raw }, 'redpanda unreachable or topic missing at startup');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    // Stop taking requests and let in-flight ones finish (each awaits its broker ack),
    // then close the producer. The reverse order would fail those requests with 503.
    await app.close();
    await publisher.close();
    process.exit(0);
  });
}
