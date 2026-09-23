import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated bootstrap brokers. */
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((b) => b.trim())),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
