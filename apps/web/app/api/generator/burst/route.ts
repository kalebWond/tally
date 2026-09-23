import { GeneratorBurstRequest } from '@tally/contracts';
import { readAdminJson } from '@/lib/api';
import { callGenerator } from '@/lib/generator';

export async function POST(request: Request) {
  const req = await readAdminJson(request, GeneratorBurstRequest);
  return 'response' in req ? req.response : callGenerator('/burst', req.data);
}
