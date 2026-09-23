import { z } from 'zod';
import { contestAnalytics } from '@/lib/analytics';
import { apiError, readParam, unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

/** `GET /api/analytics/:contestId`: every analytics chart's data, from ClickHouse only. */
export async function GET(_request: Request, ctx: RouteContext<'/api/analytics/[contestId]'>) {
  if (!(await isAdmin())) return unauthorized();
  const id = readParam(z.uuid(), (await ctx.params).contestId, 'contestId');
  if ('response' in id) return id.response;
  try {
    return Response.json(await contestAnalytics(id.data));
  } catch (err) {
    return apiError(502, 'analytics_unavailable', [
      { path: '', message: `ClickHouse didn't answer: ${(err as Error).message.slice(0, 200)}` },
    ]);
  }
}
