import 'server-only';
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.url(),
  /** Gateway address as the *browser* sees it (ws:// or wss://). Read per request, never baked into the build. */
  GATEWAY_PUBLIC_URL: z
    .url()
    .refine((u) => /^wss?:\/\//.test(u), 'must start with ws:// or wss://'),
});

/** Call only after `await connection()`, so values come from the runtime environment. */
export const serverEnv = () => Env.parse(process.env);

/** The generator's control API, server-side only: the browser never talks to it directly. */
export const generatorUrl = () => z.url().parse(process.env.GENERATOR_URL);
