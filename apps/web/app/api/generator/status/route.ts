import { isAdmin } from '@/lib/auth';
import { callGenerator, unauthorized } from '@/lib/generator';

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  return callGenerator('/status');
}
