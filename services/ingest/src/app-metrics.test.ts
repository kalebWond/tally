import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

// F23: ingest exposes Prometheus metrics that move with traffic.
const app = buildApp({
  config: { LOG_LEVEL: 'fatal', VOTER_HASH_SALT: 'test-salt-long-enough' },
  publisher: { publish: async () => {} },
  isReady: async () => true,
});
const vote = {
  contestId: '0192f3a0-7c1e-7000-8000-00000000c0de',
  code: 'C1',
  sender: '+447700900000',
  source: 'web',
};
const metric = (text: string, line: RegExp) => Number(text.match(line)?.[1] ?? Number.NaN);

describe('GET /metrics', () => {
  it('counts accepted votes and requests by status, and times them', async () => {
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/votes', payload: vote });
    await app.inject({ method: 'POST', url: '/votes', payload: { code: 'C1' } }); // 400
    const text = (await app.inject({ method: 'GET', url: '/metrics' })).body;

    expect(metric(text, /^tally_ingest_votes_accepted_total\{[^}]*\} (\d+)/m)).toBe(3);
    expect(
      metric(text, /^tally_ingest_requests_total\{[^}]*route="\/votes",status="202"[^}]*\} (\d+)/m),
    ).toBe(3);
    expect(
      metric(text, /^tally_ingest_requests_total\{[^}]*route="\/votes",status="400"[^}]*\} (\d+)/m),
    ).toBe(1);
    expect(
      metric(
        text,
        /^tally_ingest_request_duration_seconds_count\{[^}]*route="\/votes"[^}]*\} (\d+)/m,
      ),
    ).toBe(4);
    expect(text).toMatch(/service="ingest"/);
  });
});
