import { type ErrorResponse, GeneratorStartRequest } from '@tally/contracts';
import { readAdminJson } from '@/lib/api';
import { getEntrants } from '@/lib/contests';
import { callGenerator } from '@/lib/generator';

/** The panel picks a contest; the codes come from Postgres, so the browser can't invent any. */
const StartFromPanel = GeneratorStartRequest.omit({ codes: true });

export async function POST(request: Request) {
  const req = await readAdminJson(request, StartFromPanel);
  if ('response' in req) return req.response;

  // Active contestants only: votes for a deactivated one would all be dead-lettered.
  const codes = (await getEntrants(req.data.contestId)).filter((e) => e.active).map((e) => e.code);
  if (codes.length === 0) {
    return Response.json(
      {
        error: 'invalid_request',
        issues: [
          { path: 'contestId', message: 'This contest has no active contestants to vote for.' },
        ],
      } satisfies ErrorResponse,
      { status: 400 },
    );
  }
  return callGenerator('/start', { ...req.data, codes });
}
