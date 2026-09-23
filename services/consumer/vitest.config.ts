import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineProject } from 'vitest/config';

// Host runs read the repo-root .env; CI and containers provide DATABASE_URL, REDIS_URL and KAFKA_BROKERS directly and win.
const dotenv = new URL('../../.env', import.meta.url);
const fileEnv = existsSync(dotenv) ? parseEnv(readFileSync(dotenv, 'utf8')) : {};

export default defineProject({
  test: {
    name: '@tally/consumer',
    env: { ...fileEnv, ...process.env } as Record<string, string>,
    // Test files share one Postgres server and Redis DB 15; run them one at a time.
    fileParallelism: false,
  },
});
