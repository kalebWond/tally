import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** HMAC key for sender hashing. Rotating it changes every voter_hash. */
  VOTER_HASH_SALT: z.string().min(16, 'VOTER_HASH_SALT must be at least 16 characters'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
