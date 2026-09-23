import { z } from 'zod';

/** Shape returned by every service's `GET /health`. The Go generator mirrors this. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
