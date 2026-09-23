import { createServer } from 'node:http';
import type { HealthResponse } from '@tally/contracts';
import type { Metrics } from '@tally/metrics';

type Dependency = 'connected' | 'disconnected';
export type DependencyChecks = () => Promise<{
  redpanda: Dependency;
  postgres: Dependency;
  redis: Dependency;
}>;

/** 200 when every dependency answers, 503 `degraded` otherwise; `/metrics` for Prometheus. */
export function createHealthServer(check: DependencyChecks, metrics?: Metrics) {
  return createServer((req, res) => {
    if (metrics && req.method === 'GET' && req.url === '/metrics') {
      void metrics
        .render()
        .then((body) => res.writeHead(200, { 'content-type': metrics.contentType }).end(body));
      return;
    }
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    void check().then((deps) => {
      const ok = Object.values(deps).every((d) => d === 'connected');
      const body: HealthResponse = { status: ok ? 'ok' : 'degraded', service: 'consumer', ...deps };
      res
        .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
    });
  });
}
