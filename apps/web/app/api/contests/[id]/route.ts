import { z } from 'zod';
import { apiError, readParam, unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { removeContest } from '@/lib/contest-lifecycle';

/** `DELETE /api/contests/:id`: 204. Only a draft can be deleted (409 otherwise). */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/contests/[id]'>) {
  if (!(await isAdmin())) return unauthorized();
  const id = readParam(z.uuid(), (await ctx.params).id, 'id');
  if ('response' in id) return id.response;

  const result = await removeContest(id.data);
  if (result.ok) return new Response(null, { status: 204 });
  if (result.reason === 'not_found')
    return apiError(404, 'not_found', [{ path: 'id', message: 'No such contest.' }]);
  return apiError(409, 'conflict', [
    {
      path: 'id',
      message:
        result.reason === 'not_draft'
          ? `The contest is ${result.status}. Only a draft can be deleted; close it instead.`
          : 'The contest has votes, so it can’t be deleted.',
    },
  ]);
}
