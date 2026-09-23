// k6 load test for the ingest API (SPEC §8). Run through `pnpm load <profile>` (scripts/load.mjs),
// which also samples consumer lag and checks that no accepted vote was lost.
//
// Open model: votes arrive at a set rate whether or not earlier ones have been answered
// (ramping-arrival-rate), like SMS traffic. A slow ingest shows up as latency and, if k6 runs
// out of VUs, as dropped_iterations, never as a politely lowered rate.
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

const INGEST = __ENV.INGEST_URL || 'http://localhost:4000';
const CONTEST = __ENV.CONTEST_ID;
const CODES = (__ENV.CODES || 'C1,C2,C3,C4,C5,C6,C7,C8,C9,C10').split(',');
const RUN = __ENV.RUN_ID;
const PROFILE = __ENV.PROFILE || 'smoke';

const stage = (target, duration) => ({ target, duration });

/** Rates in votes per second. */
const PROFILES = {
  /** Harness check: 20 s at 200/s. */
  smoke: [stage(200, '5s'), stage(200, '15s')],
  /** SPEC's sustained target: ramp to 1,000/s, hold 3 minutes. */
  steady: [stage(1000, '1m'), stage(1000, '3m'), stage(0, '15s')],
  /** SPEC's burst target: 500/s baseline, a minute at 3,000/s, back to 500/s. */
  spike: [
    stage(500, '20s'),
    stage(500, '1m'),
    stage(3000, '10s'),
    stage(3000, '1m'),
    stage(500, '10s'),
    stage(500, '1m'),
    stage(0, '10s'),
  ],
};

/**
 * The plateau at the profile's top rate, [from, to) in seconds of the run. Requests in it are
 * tagged phase=peak, so latency at full rate is reported on its own, not diluted by the ramps
 * and the baseline around it.
 */
const PEAK = { smoke: [5, 20], steady: [60, 240], spike: [90, 150] }[PROFILE];

export const options = {
  scenarios: {
    votes: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 2000,
      stages: PROFILES[PROFILE],
    },
  },
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  // SPEC §8: p95 under 50 ms; zero loss means every request answered 202.
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<50'],
    // Also report the plateau on its own (k6 only summarises tagged submetrics named here).
    'http_req_duration{phase:peak}': ['p(95)<50'],
    'http_reqs{phase:peak}': ['count>0'],
    http_req_failed: ['rate==0'],
  },
};

/** Votes answered 202: ingest confirmed Redpanda has them (acks=all). The loss check counts these. */
const accepted = new Counter('votes_accepted');

export default function () {
  const code = CODES[Math.floor(Math.random() * CODES.length)];
  // Unique per vote and tagged with the run, so the wrapper can find exactly this run's votes.
  const key = `k6-${RUN}-${__VU}-${__ITER}`;
  const elapsed = exec.instance.currentTestRunDuration / 1000;
  const phase = elapsed >= PEAK[0] && elapsed < PEAK[1] ? 'peak' : 'ramp';
  const res = http.post(
    `${INGEST}/votes`,
    JSON.stringify({ contestId: CONTEST, code, sender: `k6:${__VU}:${__ITER}`, source: 'sms' }),
    { headers: { 'content-type': 'application/json', 'idempotency-key': key }, tags: { phase } },
  );
  if (check(res, { 'accepted (202)': (r) => r.status === 202 })) accepted.add(1);
}

export function handleSummary(data) {
  return { [`/out/${RUN}.json`]: JSON.stringify(data, null, 2) };
}
