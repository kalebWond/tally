import { z } from 'zod';

/**
 * Shape returned by every service's `GET /health`. Services with a hard dependency report it
 * (ingest: `redpanda`) and answer 503 with `status: "degraded"` while it is unreachable.
 * The Go generator mirrors `status` and `service`.
 */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  redpanda: z.enum(['connected', 'disconnected']).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
