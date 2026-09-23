import { GeneratorRateRequest } from '@tally/contracts';
import { callGenerator, readControlRequest } from '@/lib/generator';

/** The ramp: changes a running generator's rate without restarting the run. */
export async function POST(request: Request) {
  const req = await readControlRequest(request, GeneratorRateRequest);
  return 'response' in req ? req.response : callGenerator('/rate', req.data);
}
