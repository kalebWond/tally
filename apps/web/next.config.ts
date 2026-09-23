import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

const root = path.join(import.meta.dirname, '../..');

// Host dev convenience: fill in anything missing from the repo-root .env (Next only reads .env
// files next to this config). Real environment variables always win, and containers have no
// such file, so this is a no-op there. `node --env-file` can't be used: Next forwards execArgv
// into NODE_OPTIONS for its workers, where Node rejects that flag.
const dotenv = path.join(root, '.env');
if (existsSync(dotenv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(dotenv, 'utf8')))) {
    process.env[key] ??= value;
  }
}

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  transpilePackages: ['@tally/contracts'],
};

export default config;
