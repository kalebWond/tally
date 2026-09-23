import { ContestStatusChange } from '@tally/contracts';
import { z } from 'zod';
import { apiError, readAdminJson, readParam } from '@/lib/api';
import { changeContestStatus } from '@/lib/contest-lifecycle';

const VERB = { open: 'opened', closed: 'closed' } as const;

/**
 * `POST /api/contests/:id/status { status: "open" | "closed" }`. Closing stamps `closes_at`:
 * votes ingest accepted before it still count, later ones are dead-lettered `contest_closed`.
 * 409 for a transition that isn't allowed (draft → closed, open → open, …).
 */
export async function POST(request: Request, ctx: RouteContext<'/api/contests/[id]/status'>) {
  const req = await readAdminJson(request, ContestStatusChange);
  if ('response' in req) return req.response;
  const id = readParam(z.uuid(), (await ctx.params).id, 'id');
  if ('response' in id) return id.response;

  const result = await changeContestStatus(id.data, req.data.status);
  if (result.ok) return Response.json({ contest: result.contest, liveUpdated: result.liveUpdated });
  if (result.reason === 'not_found')
    return apiError(404, 'not_found', [{ path: 'id', message: 'No such contest.' }]);
  return apiError(409, 'conflict', [
    {
      path: 'status',
      message: `The contest is ${result.from}; it can't be ${VERB[req.data.status]} from there.`,
    },
  ]);
}
