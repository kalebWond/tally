import { GeneratorBurstRequest } from '@tally/contracts';
import { callGenerator, readControlRequest } from '@/lib/generator';

export async function POST(request: Request) {
  const req = await readControlRequest(request, GeneratorBurstRequest);
  return 'response' in req ? req.response : callGenerator('/burst', req.data);
}
