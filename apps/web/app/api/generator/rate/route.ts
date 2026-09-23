import { GeneratorRateRequest } from '@tally/contracts';
import { readAdminJson } from '@/lib/api';
import { callGenerator } from '@/lib/generator';

/** The ramp: changes a running generator's rate without restarting the run. */
export async function POST(request: Request) {
  const req = await readAdminJson(request, GeneratorRateRequest);
  return 'response' in req ? req.response : callGenerator('/rate', req.data);
}
