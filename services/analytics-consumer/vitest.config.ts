import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineProject } from 'vitest/config';

// Host runs read the repo-root .env (CLICKHOUSE_URL for the integration test); CI and
// containers provide it directly and win.
const dotenv = new URL('../../.env', import.meta.url);
const fileEnv = existsSync(dotenv) ? parseEnv(readFileSync(dotenv, 'utf8')) : {};

export default defineProject({
  test: {
    name: '@tally/analytics-consumer',
    env: { ...fileEnv, ...process.env } as Record<string, string>,
  },
});
