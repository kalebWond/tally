import { DeadLetterQuery } from '@tally/contracts';
import type { NextRequest } from 'next/server';
import { readQuery, unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { queryDeadLetters } from '@/lib/dead-letters';

/** `GET /api/dead-letters?contestId=&reason=&before=|after=&limit=`: newest first, keyset-paged. */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const q = readQuery(request.nextUrl, DeadLetterQuery);
  if ('response' in q) return q.response;
  return Response.json(await queryDeadLetters(db(), q.data));
}
