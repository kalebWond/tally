import { type Contestant, ContestantBatchCreate } from '@tally/contracts';
import { createContestants } from '@tally/db';
import { apiError, readAdminJson } from '@/lib/api';
import { db } from '@/lib/db';

/**
 * `POST /api/contestants/batch { contestId, contestants: [...] }` (F27): 201 with every new
 * contestant, or nothing added. 409 names each row whose code the contest already uses.
 */
export async function POST(request: Request) {
  const req = await readAdminJson(request, ContestantBatchCreate);
  if ('response' in req) return req.response;
  const result = await createContestants(db(), req.data.contestId, req.data.contestants);
  if (result.ok)
    return Response.json(
      result.contestants.map(({ createdAt: _, ...c }): Contestant => c),
      { status: 201 },
    );
  if (result.reason === 'no_contest')
    return apiError(400, 'invalid_request', [{ path: 'contestId', message: 'No such contest.' }]);
  return apiError(
    409,
    'conflict',
    result.taken.map((t) => ({
      path: `contestants.${t.index}.code`,
      message: `${t.code} is already used by ${t.holder} in this contest.`,
    })),
  );
}
