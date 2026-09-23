import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics for one service (F23): a registry labelled `service`, with Node's process
 * metrics (CPU, memory, event-loop lag) included. Each service adds its own counters and
 * histograms through the helpers, and serves `render()` at `GET /metrics`.
 */
export function createMetrics(service: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry, prefix: 'tally_' });

  return {
    registry,
    counter: <L extends string>(name: string, help: string, labelNames: readonly L[] = []) =>
      new Counter<L>({ name, help, labelNames, registers: [registry] }),
    /** `read`, if given, runs at every scrape and returns the current value. */
    gauge: (name: string, help: string, read?: () => number) =>
      new Gauge({
        name,
        help,
        registers: [registry],
        ...(read && {
          collect(this: Gauge) {
            this.set(read());
          },
        }),
      }),
    histogram: <L extends string>(
      name: string,
      help: string,
      buckets: number[],
      labelNames: readonly L[] = [],
    ) => new Histogram<L>({ name, help, buckets, labelNames, registers: [registry] }),
    contentType: registry.contentType,
    render: () => registry.metrics(),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

/** Latency buckets in seconds, 1 ms to 5 s, dense where ingest lives (single-digit ms). */
export const LATENCY_BUCKETS = [
  0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];
