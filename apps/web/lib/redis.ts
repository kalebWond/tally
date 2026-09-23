import 'server-only';
import { Redis } from 'ioredis';
import { redisUrl } from './server-env';

// One connection per server process. Dev hot reloads re-evaluate modules, so keep it on globalThis.
const cache = globalThis as unknown as { tallyRedis?: Redis };

/** Fails fast: an admin action shouldn't hang on Redis, whose copy is only a mirror of Postgres. */
export function redis(): Redis {
  cache.tallyRedis ??= new Redis(redisUrl(), { maxRetriesPerRequest: 1, commandTimeout: 1000 });
  return cache.tallyRedis;
}
