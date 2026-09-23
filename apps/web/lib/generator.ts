import 'server-only';
import { ErrorResponse, GeneratorStatus } from '@tally/contracts';
import { apiError } from './api';
import { generatorUrl } from './server-env';

type Path = '/status' | '/start' | '/rate' | '/burst' | '/stop';

const error = (status: number, code: string, message: string) =>
  apiError(status, code, [{ path: '', message }]);

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
