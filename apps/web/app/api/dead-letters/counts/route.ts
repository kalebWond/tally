import { DeadLetterCountsQuery } from '@tally/contracts';
import type { NextRequest } from 'next/server';
import { readQuery, unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { countDeadLetters } from '@/lib/dead-letters';

/** `GET /api/dead-letters/counts?contestId=&since=`: per-reason counts, for the filter chips and the "new" banner. */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const q = readQuery(request.nextUrl, DeadLetterCountsQuery);
  if ('response' in q) return q.response;
  return Response.json(await countDeadLetters(db(), q.data));
}
