import { ContestantUpdate } from '@tally/contracts';
import { z } from 'zod';
import { updateContestant } from '@/lib/admin-contestants';
import { apiError, readAdminJson, readParam } from '@/lib/api';

/**
 * `PATCH /api/contestants/:id`: edit details, or `{ active: false }` to deactivate (later votes
 * are dead-lettered as `inactive_contestant` within 5 s). The code can't change: 400.
 */
export async function PATCH(request: Request, ctx: RouteContext<'/api/contestants/[id]'>) {
  const req = await readAdminJson(request, ContestantUpdate);
  if ('response' in req) return req.response;
  const id = readParam(z.uuid(), (await ctx.params).id, 'id');
  if ('response' in id) return id.response;

  const contestant = await updateContestant(id.data, req.data);
  return contestant
    ? Response.json(contestant)
    : apiError(404, 'not_found', [{ path: 'id', message: 'No such contestant.' }]);
}
