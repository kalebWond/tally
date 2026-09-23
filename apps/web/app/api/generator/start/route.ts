import { type ErrorResponse, GeneratorStartRequest } from '@tally/contracts';
import { getEntrants } from '@/lib/contests';
import { callGenerator, readControlRequest } from '@/lib/generator';

/** The panel picks a contest; the codes come from Postgres, so the browser can't invent any. */
const StartFromPanel = GeneratorStartRequest.omit({ codes: true });

export async function POST(request: Request) {
  const req = await readControlRequest(request, StartFromPanel);
  if ('response' in req) return req.response;

  const codes = (await getEntrants(req.data.contestId)).map((e) => e.code);
  if (codes.length === 0) {
    return Response.json(
      {
        error: 'invalid_request',
        issues: [{ path: 'contestId', message: 'This contest has no contestants to vote for.' }],
      } satisfies ErrorResponse,
      { status: 400 },
    );
  }
  return callGenerator('/start', { ...req.data, codes });
}
