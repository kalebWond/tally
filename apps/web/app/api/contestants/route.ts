import { ContestantCreate } from '@tally/contracts';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContestant, listContestants } from '@/lib/admin-contestants';
import { apiError, readAdminJson, readParam, unauthorized } from '@/lib/api';
import { isAdmin } from '@/lib/auth';

/** `GET /api/contestants?contestId=…`: every contestant in the contest, inactive included. */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const contestId = readParam(z.uuid(), request.nextUrl.searchParams.get('contestId'), 'contestId');
  if ('response' in contestId) return contestId.response;
  return Response.json(await listContestants(contestId.data));
}

/** `POST /api/contestants`: 201 with the contestant; 409 when the code is taken in that contest. */
export async function POST(request: Request) {
  const req = await readAdminJson(request, ContestantCreate);
  if ('response' in req) return req.response;
  const result = await createContestant(req.data);
  if ('issue' in result) {
    return apiError(result.status, result.status === 409 ? 'conflict' : 'invalid_request', [
      result.issue,
    ]);
  }
  return Response.json(result.contestant, { status: 201 });
}
