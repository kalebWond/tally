import { parseBacklog, redisKeys } from '@tally/contracts';
import { apiError, unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { redis } from '@/lib/redis';

/**
 * `GET /api/generator/backlog` (F29): votes accepted but not yet counted, across all contests,
 * as the consumers last reported them. `{ backlog: null }` when no consumer is reporting.
 */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    const hash = await redis().hgetall(redisKeys.backlog);
    return Response.json({ backlog: parseBacklog(hash, Date.now()) });
  } catch {
    return apiError(503, 'redis_unavailable', [
      { path: '', message: 'Redis is not answering, so the queue can’t be read.' },
    ]);
  }
}
