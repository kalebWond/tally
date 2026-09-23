import { parseArgs } from 'node:util';
import { createDb, schema } from '@tally/db';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { type ContestReport, reconcileContest } from '../reconcile.js';

// F18: recount every contest from the vote log and compare vote_totals, vote_buckets and Redis
// with it. Exit 0 = no drift (or all of it repaired), 1 = drift found and not repaired, 2 = error.
//
//   pnpm reconcile [--repair] [--contest <uuid>] [--json]
//   docker compose run --rm reconcile [--repair] …

const USAGE = 'usage: reconcile [--repair] [--contest <uuid>] [--json]';

const { values } = parseArgs({
  options: {
    repair: { type: 'boolean', default: false },
    contest: { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const env = z.object({ DATABASE_URL: z.url(), REDIS_URL: z.url() }).parse(process.env);
const contestArg = values.contest === undefined ? undefined : z.uuid().parse(values.contest);

const { db, close } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });

try {
  const ids = contestArg
    ? [contestArg]
    : (await db.select({ id: schema.contests.id }).from(schema.contests)).map((c) => c.id);
  const reports: ContestReport[] = [];
  for (const id of ids) {
    const report = await reconcileContest(db, redis, id, { repair: values.repair });
    if (!report) throw new Error(`no contest ${id}`);
    reports.push(report);
  }

  const unresolved = reports.some((r) => (r.afterRepair ?? r.drift).length > 0);
  if (values.json) console.log(JSON.stringify(reports, null, 2));
  else print(reports, values.repair);
  process.exitCode = unresolved ? 1 : 0;
} catch (err) {
  console.error(`reconcile failed: ${(err as Error).message}`);
  process.exitCode = 2;
} finally {
  redis.disconnect();
  await close();
}

function print(reports: ContestReport[], repair: boolean) {
  const n = new Intl.NumberFormat('en');
  for (const r of reports) {
    console.log(`\n${r.name} (${r.contestId})`);
    console.log(`  ${n.format(r.votes)} votes in the log; counting paused ${r.pausedMs} ms`);
    if (r.drift.length === 0) {
      console.log('  ✓ no drift: vote_totals, vote_buckets and Redis all match the vote log');
      continue;
    }
    console.log(`  ✗ ${r.drift.length} drifted value${r.drift.length === 1 ? '' : 's'}:`);
    const rows = r.drift.map((d) => [
      d.layer,
      d.key,
      n.format(d.expected),
      d.actual === null ? 'missing' : n.format(d.actual),
    ]);
    const head = ['layer', 'key', 'expected', 'actual'];
    const widths = head.map((h, i) =>
      Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
    );
    const line = (cells: string[]) =>
      `    ${cells.map((c, i) => (i >= 2 ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0))).join('  ')}`;
    console.log(line(head));
    for (const row of rows.slice(0, 50)) console.log(line(row.map(String)));
    if (rows.length > 50) console.log(`    … and ${rows.length - 50} more (--json for all)`);
    if (r.afterRepair) {
      console.log(
        r.afterRepair.length === 0
          ? '  ✓ repaired: every layer now matches the vote log'
          : `  ✗ ${r.afterRepair.length} still drifted after repair`,
      );
    } else if (!repair) {
      console.log('  run with --repair to rewrite them from the vote log');
    }
  }
}
