import 'server-only';
import { ErrorResponse, GeneratorStatus } from '@tally/contracts';
import type { z } from 'zod';
import { isAdmin } from './auth';
import { generatorUrl } from './server-env';

type Path = '/status' | '/start' | '/rate' | '/burst' | '/stop';

const error = (status: number, code: string, message = '') =>
  Response.json(
    { error: code, issues: message ? [{ path: '', message }] : [] } satisfies ErrorResponse,
    {
      status,
    },
  );

/**
 * Forwards one call to the generator's control API and relays the answer: a GeneratorStatus on
 * success, the generator's ErrorResponse (400/409) otherwise. 502 when it's down or answers with
 * something that isn't in the contract.
 */
export async function callGenerator(path: Path, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(new URL(path, generatorUrl()), {
      method: path === '/status' ? 'GET' : 'POST',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return error(502, 'generator_unreachable', 'The generator is not answering. Is it running?');
  }
  const json: unknown = await res.json().catch(() => undefined);
  const parsed = res.ok ? GeneratorStatus.safeParse(json) : ErrorResponse.safeParse(json);
  if (!parsed.success)
    return error(502, 'bad_gateway', `The generator answered ${res.status} outside the contract.`);
  return Response.json(parsed.data, { status: res.status });
}

/**
 * The checks every control route runs before touching the generator: a valid admin session
 * (proxy.ts already filtered, this is the authoritative check), a JSON body (a cross-site form
 * can't send one), and the request schema.
 */
export async function readControlRequest<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S> } | { response: Response }> {
  if (!(await isAdmin())) return { response: error(401, 'unauthorized') };
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return { response: error(415, 'unsupported_media_type', 'Send a JSON body.') };
  }
  const body = schema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    const issues = body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return {
      response: Response.json({ error: 'invalid_request', issues } satisfies ErrorResponse, {
        status: 400,
      }),
    };
  }
  return { data: body.data };
}

export const unauthorized = () => error(401, 'unauthorized');
