import { createServer } from 'node:http';
import type { HealthResponse } from '@tally/contracts';

export function createHealthServer() {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body: HealthResponse = { status: 'ok', service: 'consumer' };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });
}
