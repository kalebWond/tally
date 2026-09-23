import { z } from 'zod';

/**
 * Shape returned by every service's `GET /health`. Services report their hard dependencies
 * (ingest: `redpanda`; consumer: `redpanda`, `postgres`, `redis`) and answer 503 with
 * `status: "degraded"` while any of them is unreachable.
 * The Go generator mirrors `status` and `service`.
 */
const Dependency = z.enum(['connected', 'disconnected']);

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  redpanda: Dependency.optional(),
  postgres: Dependency.optional(),
  redis: Dependency.optional(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
