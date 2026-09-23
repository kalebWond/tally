import type { HealthResponse } from '@tally/contracts';
import Fastify from 'fastify';
import type { Config } from './config.js';

export function buildApp(config: Pick<Config, 'LOG_LEVEL'>) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok', service: 'ingest' }));

  return app;
}
