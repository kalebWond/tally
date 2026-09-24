import { ContestCreate } from '@tally/contracts';
import { apiError, readAdminJson } from '@/lib/api';
import { addContest } from '@/lib/contest-lifecycle';

/** `POST /api/contests { name }`: 201 with the new draft contest; 409 when the name is taken. */
export async function POST(request: Request) {
  const req = await readAdminJson(request, ContestCreate);
  if ('response' in req) return req.response;
  const result = await addContest(req.data.name);
  if (result.ok) return Response.json(result.contest, { status: 201 });
  return apiError(409, 'conflict', [
    {
      path: 'name',
      message: `“${result.holder}” already exists. Contest names are unique, ignoring case.`,
    },
  ]);
}
