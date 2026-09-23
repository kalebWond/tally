import { z } from 'zod';

const Env = z.object({ DATABASE_URL: z.url() });

export const loadEnv = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
