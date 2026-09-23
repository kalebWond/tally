import 'server-only';
import type { ErrorResponse } from '@tally/contracts';
import type { z } from 'zod';
import { isAdmin } from './auth';

/** An error in the shape every Tally API uses (contracts: ErrorResponse). */
export const apiError = (status: number, error: string, issues: ErrorResponse['issues'] = []) =>
  Response.json({ error, issues } satisfies ErrorResponse, { status });

export const unauthorized = () => apiError(401, 'unauthorized');

const issuesFrom = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/**
 * The checks every admin write runs first: a valid admin session (proxy.ts already filtered;
 * this is the authoritative check), a JSON body (a cross-site HTML form can't send one), and
 * the request schema.
 */
export async function readAdminJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S> } | { response: Response }> {
  if (!(await isAdmin())) return { response: unauthorized() };
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return {
      response: apiError(415, 'unsupported_media_type', [
        { path: '', message: 'Send a JSON body.' },
      ]),
    };
  }
  const body = schema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) return { response: apiError(400, 'invalid_request', issuesFrom(body.error)) };
  return { data: body.data };
}

/** Validates a query-string or path value; the 400 names the parameter. */
export function readParam<S extends z.ZodType>(schema: S, value: unknown, name: string) {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { data: parsed.data as z.output<S> }
    : {
        response: apiError(400, 'invalid_request', [
          { path: name, message: parsed.error.issues[0]?.message ?? 'is invalid' },
        ]),
      };
}
