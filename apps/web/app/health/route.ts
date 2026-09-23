import type { HealthResponse } from '@tally/contracts';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'web' } satisfies HealthResponse);
}
