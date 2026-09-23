import { unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { callGenerator } from '@/lib/generator';

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  return callGenerator('/status');
}
