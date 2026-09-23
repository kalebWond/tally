import { createMetrics, type Metrics } from '@tally/metrics';

// Prometheus (F23): the web server's process metrics (CPU, memory, event-loop lag). Nothing
// about votes or sessions, so it needs no password. One registry per process: dev reloads
// re-evaluate this module, so it lives on globalThis.
const cache = globalThis as unknown as { tallyWebMetrics?: Metrics };

export async function GET() {
  cache.tallyWebMetrics ??= createMetrics('web');
  return new Response(await cache.tallyWebMetrics.render(), {
    headers: { 'content-type': cache.tallyWebMetrics.contentType },
  });
}
