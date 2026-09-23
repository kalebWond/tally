import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4004),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated bootstrap brokers. */
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((b) => b.trim())),
  CLICKHOUSE_URL: z.url(),
  CLICKHOUSE_USER: z.string().min(1).default('tally'),
  CLICKHOUSE_PASSWORD: z.string().default(''),
  CLICKHOUSE_DB: z.string().min(1).default('tally'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
