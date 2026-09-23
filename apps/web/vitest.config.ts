import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineProject } from 'vitest/config';

// Host runs read the repo-root .env (the dead-letter query test needs DATABASE_URL); CI and
// containers provide it directly and win.
const dotenv = new URL('../../.env', import.meta.url);
const fileEnv = existsSync(dotenv) ? parseEnv(readFileSync(dotenv, 'utf8')) : {};

export default defineProject({
  test: {
    name: '@tally/web',
    env: { ...fileEnv, ...process.env } as Record<string, string>,
  },
});
