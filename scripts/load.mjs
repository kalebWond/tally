#!/usr/bin/env node
// F19: reproducible load test. `pnpm load <smoke|steady|spike>` against the running stack
// (`docker compose --profile app up -d --build`). Runs k6 (tools/load/votes.js) in the
// grafana/k6 image, samples consumer lag from Redpanda every second, waits for the consumer to
// drain, then checks that every vote ingest accepted was counted exactly once and that
// reconciliation finds no drift. Writes load-results/<run>.md (committed) plus raw k6 JSON
// and a lag CSV (not committed).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const PROFILE = process.argv[2] ?? 'smoke';
const K6_IMAGE = 'grafana/k6:2.3.0';
const CONTEST = process.env.CONTEST_ID ?? '0192f3a0-7c1e-7000-8000-00000000c0de';
// k6 runs inside the compose network and calls ingest by service name: going through the
// host's published port adds docker-proxy, a userspace copy of every request, which at
// 3,000 req/s costs CPU and latency that a real deployment wouldn't have.
const NETWORK = process.env.COMPOSE_NETWORK ?? 'tally_default';
const INGEST = process.env.INGEST_URL ?? 'http://ingest:4000';
const OUT = path.join(ROOT, 'load-results');

if (!['smoke', 'steady', 'spike'].includes(PROFILE)) {
  console.error('usage: pnpm load <smoke|steady|spike>');
  process.exit(2);
}

const sh = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const psql = (q) =>
  sh('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'tally', '-Atc', q]);
const lag = () => {
  try {
    const out = sh('docker', [
      'compose',
      'exec',
      '-T',
      'redpanda',
      'rpk',
      'group',
      'describe',
      'tally-consumer',
    ]);
    return Number(out.match(/TOTAL-LAG\s+(\d+)/)?.[1] ?? Number.NaN);
  } catch {
    return Number.NaN;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, digits = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : '—';

// --- preconditions ---------------------------------------------------------------------------
const status = psql(`select status from contests where id = '${CONTEST}'`);
if (status !== 'open')
  throw new Error(`contest ${CONTEST} must be open (it is "${status || 'missing'}")`);
const codes = psql(
  `select string_agg(code, ',' order by code) from contestants where contest_id = '${CONTEST}' and active`,
);
try {
  await fetch('http://localhost:4002/stop', { method: 'POST' }); // no generator traffic mixed in
} catch {}
const health = await fetch('http://localhost:4000/health').then(
  (r) => r.status,
  () => 0,
);
if (health !== 200)
  throw new Error(`ingest not healthy (HTTP ${health}); start the stack with --profile app`);

const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}-${PROFILE}`;
mkdirSync(OUT, { recursive: true });
console.log(`run ${runId}: ${PROFILE} profile against ${INGEST}, contest ${CONTEST}`);

// --- run k6, sampling consumer lag alongside -----------------------------------------------
const samples = [];
let sampling = true;
const sampler = (async () => {
  const t0 = Date.now();
  while (sampling) {
    samples.push({ t: (Date.now() - t0) / 1000, lag: lag() });
    await sleep(1000);
  }
})();

const k6 = spawn(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    NETWORK,
    '-v',
    `${path.join(ROOT, 'tools/load')}:/scripts:ro`,
    '-v',
    `${OUT}:/out`,
    '--user',
    `${os.userInfo().uid}:${os.userInfo().gid}`,
    '-e',
    `PROFILE=${PROFILE}`,
    '-e',
    `RUN_ID=${runId}`,
    '-e',
    `CONTEST_ID=${CONTEST}`,
    '-e',
    `CODES=${codes}`,
    '-e',
    `INGEST_URL=${INGEST}`,
    K6_IMAGE,
    'run',
    '--quiet',
    '--no-color',
    '/scripts/votes.js',
  ],
  { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
);
const k6Exit = await new Promise((r) => k6.on('close', r));

// --- drain: wait for the consumer to catch up ------------------------------------------------
const drainStart = Date.now();
while (Date.now() - drainStart < 180_000 && lag() !== 0) await sleep(500);
const drainSeconds = (Date.now() - drainStart) / 1000;
sampling = false;
await sampler;
writeFileSync(
  path.join(OUT, `${runId}-lag.csv`),
  `t_s,lag\n${samples.map((s) => `${s.t.toFixed(1)},${s.lag}`).join('\n')}\n`,
);

// --- results ---------------------------------------------------------------------------------
const summary = JSON.parse(readFileSync(path.join(OUT, `${runId}.json`), 'utf8'));
const m = summary.metrics;
const ok = m['http_req_duration{expected_response:true}']?.values ?? m.http_req_duration.values;
const requests = m.http_reqs.values.count;
const peak = m['http_req_duration{phase:peak}']?.values;
const peakReqs = m['http_reqs{phase:peak}']?.values.count ?? 0;
const [peakFrom, peakTo] = { smoke: [5, 20], steady: [60, 240], spike: [90, 150] }[PROFILE];
// k6's own test duration: the wall clock above also includes pulling and starting the container.
const testSeconds = summary.state.testRunDurationMs / 1000;
const acceptedByK6 = m.votes_accepted?.values.count ?? 0;
const failedRate = m.http_req_failed.values.rate;
const dropped = m.dropped_iterations?.values.count ?? 0;
const counted = Number(
  psql(`select count(*) from votes where idempotency_key like 'k6-${runId}-%'`),
);
const deadLettered = Number(
  psql(`select count(*) from dead_letters where idempotency_key like 'k6-${runId}-%'`),
);
let reconcileExit = 0;
try {
  sh('pnpm', ['-s', 'reconcile', '--contest', CONTEST]);
} catch (err) {
  reconcileExit = err.status ?? 2;
}
const peakRate = Math.max(...PROFILE_PEAK(PROFILE));
const lags = samples.map((s) => s.lag).filter(Number.isFinite);
const maxLag = Math.max(0, ...lags);
const cpu = os.cpus()[0]?.model.replace(/\s+/g, ' ') ?? 'unknown';

const pass = {
  p95: ok['p(95)'] < 50,
  peak: (peak?.['p(95)'] ?? Number.POSITIVE_INFINITY) < 50,
  errors: failedRate === 0,
  loss: counted === acceptedByK6 && deadLettered === 0,
  reconcile: reconcileExit === 0,
};

const report = `# Load test: ${PROFILE} (${runId})

- **Profile:** ${describe(PROFILE)}
- **Target:** ingest \`POST /votes\` (${INGEST}), contest \`${CONTEST}\`, ${codes.split(',').length} codes
- **Machine:** ${cpu}, ${os.cpus().length} threads, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM: a developer laptop, shared by k6, the whole stack and the desktop. k6 runs in the compose network.
- **Tool:** ${K6_IMAGE}, open model (ramping-arrival-rate)

| Metric | Result | Target (SPEC §8) |
|---|---|---|
| Requests | ${fmt(requests)} in ${fmt(testSeconds, 1)} s | |
| Throughput, whole run | ${fmt(requests / testSeconds, 0)} votes/s average including ramps; ${fmt(peakRate)} votes/s offered at the peak | ${PROFILE === 'spike' ? '3,000+ burst' : '1,000 sustained'} |
| Accepted (202) | ${fmt(acceptedByK6)} | all |
| Errors | ${fmt(failedRate * 100, 3)} % | 0 ${pass.errors ? '✓' : '✗'} |
| Dropped iterations (k6 couldn't keep up) | ${fmt(dropped)} | 0 |
| Throughput at the peak (${peakFrom}–${peakTo} s) | ${fmt(peakReqs / (peakTo - peakFrom), 0)} votes/s delivered | |
| Latency at the peak, p50 / p95 / p99 / max | ${fmt(peak?.med, 1)} / **${fmt(peak?.['p(95)'], 1)}** / ${fmt(peak?.['p(99)'], 1)} / ${fmt(peak?.max, 1)} ms | p95 < 50 ms ${pass.peak ? '✓' : '✗'} |
| Latency over the whole run, p50 / p95 / p99 / max | ${fmt(ok.med, 1)} / ${fmt(ok['p(95)'], 1)} / ${fmt(ok['p(99)'], 1)} / ${fmt(ok.max, 1)} ms | p95 < 50 ms ${pass.p95 ? '✓' : '✗'} |
| Consumer lag, max | ${fmt(maxLag)} messages | |
| Drain after the load stopped | ${fmt(drainSeconds, 1)} s | |
| Counted in Postgres | ${fmt(counted)} of ${fmt(acceptedByK6)} accepted; ${fmt(deadLettered)} dead-lettered | zero loss ${pass.loss ? '✓' : '✗'} |
| Reconciliation (\`pnpm reconcile\`) | ${reconcileExit === 0 ? 'no drift' : `exit ${reconcileExit}`} | no drift ${pass.reconcile ? '✓' : '✗'} |

Consumer lag over the run (messages, sampled every second): ${sparkline(lags)}

Reproduce: \`docker compose --profile app up -d --build\`, then \`pnpm load ${PROFILE}\`.
`;
writeFileSync(path.join(OUT, `${runId}.md`), report);
console.log(`\n${report}`);
console.log(`report: load-results/${runId}.md`);
const allPass = Object.values(pass).every(Boolean) && k6Exit === 0;
process.exit(allPass ? 0 : 1);

function PROFILE_PEAK(p) {
  return { smoke: [200], steady: [1000], spike: [3000] }[p];
}
function describe(p) {
  return {
    smoke: '20 s at 200 votes/s (harness check)',
    steady: 'ramp to 1,000 votes/s over 1 min, hold 3 min, ramp down',
    spike: '500 votes/s baseline, 10 s ramp to 3,000 votes/s, hold 1 min, back to 500 votes/s',
  }[p];
}
/** Lag over time as a one-line unicode chart, one character per ~5 s. */
function sparkline(values) {
  if (values.length === 0) return '—';
  const bars = '▁▂▃▄▅▆▇█';
  const step = Math.max(1, Math.round(values.length / 60));
  const points = [];
  for (let i = 0; i < values.length; i += step) points.push(Math.max(...values.slice(i, i + step)));
  const top = Math.max(1, ...points);
  return `\`${points.map((v) => bars[Math.min(7, Math.floor((v / top) * 7.999))]).join('')}\` (peak ${fmt(top)})`;
}
