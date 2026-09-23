import { HealthResponse } from '@tally/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  it('returns 200 with the shared health contract', async () => {
    const app = buildApp({ LOG_LEVEL: 'fatal' });
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: 'ok', service: 'ingest' });
  });
});
