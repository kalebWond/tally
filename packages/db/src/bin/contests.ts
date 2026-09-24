import { createDb } from '../client.ts';
import { listContests } from '../contest-admin.ts';
import { loadEnv } from '../env.ts';

// `pnpm contests` (F28): every contest, newest first, with the ID `pnpm recap <id>` takes.

const when = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace('T', ' ')}` : '—');
const n = new Intl.NumberFormat('en');

const { db, close } = createDb(loadEnv().DATABASE_URL);
try {
  const rows = (await listContests(db)).map((c) => [
    c.id,
    c.name,
    c.status,
    c.activeContestants === c.contestants
      ? String(c.contestants)
      : `${c.activeContestants} of ${c.contestants}`,
    n.format(c.votes),
    when(c.opensAt),
    when(c.closesAt),
  ]);
  const header = ['ID', 'NAME', 'STATUS', 'CONTESTANTS', 'VOTES', 'OPENED (UTC)', 'CLOSED (UTC)'];
  const right = new Set([3, 4]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (right.has(i) ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();
  console.log(line(header));
  for (const r of rows) console.log(line(r));
  if (rows.length === 0) console.log('No contests. Create one at /admin/contests.');
  else console.log('\nRender one: pnpm recap <ID>');
} finally {
  await close();
}
