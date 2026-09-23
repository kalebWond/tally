import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z.url(),
  /** How often each watched contest is read from Redis. Bounds vote-to-screen latency. */
  GATEWAY_POLL_MS: z.coerce.number().int().min(20).default(250),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
