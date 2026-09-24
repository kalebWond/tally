import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { bundle } from '@remotion/bundler';
import { getVideoMetadata, renderMedia, selectComposition } from '@remotion/renderer';
import { createDb, schema } from '@tally/db';
import { exportRecap } from '@tally/recap-video/export';
import { desc, sql } from 'drizzle-orm';
import { z } from 'zod';

// F25: `pnpm recap [contestId] [--out file.mp4]` renders a contest's results recap: intro, bar
// race over its minute-by-minute history, final standings, winner reveal. Data comes straight
// from Postgres; nothing to edit by hand. Default contest: the most recently closed one.

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' } },
});
const env = z.object({ DATABASE_URL: z.url() }).parse(process.env);
const { db, close } = createDb(env.DATABASE_URL);

try {
  const contestId =
    positionals[0] ??
    (
      await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .orderBy(sql`${schema.contests.status} = 'closed' desc`, desc(schema.contests.closesAt))
        .limit(1)
    )[0]?.id;
  if (!contestId || !z.uuid().safeParse(contestId).success)
    throw new Error('usage: pnpm recap [contestId] [--out file.mp4]');

  const data = await exportRecap(db, contestId);
  if (data.contestants.length === 0) throw new Error(`contest ${contestId} has no contestants`);
  if (data.contest.status !== 'closed')
    console.warn(
      `note: "${data.contest.name}" is ${data.contest.status}; the recap shows results so far`,
    );
  const slug = data.contest.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const out = path.resolve(
    values.out ?? path.join(import.meta.dirname, '../../../../recaps', `${slug}.mp4`),
  );
  mkdirSync(path.dirname(out), { recursive: true });
  console.log(
    `${data.contest.name}: ${data.totalVotes.toLocaleString('en')} votes, ${data.contestants.length} contestants, ${data.steps.length} race steps`,
  );

  const serveUrl = await bundle({ entryPoint: path.join(import.meta.dirname, '../index.ts') });
  const composition = await selectComposition({ serveUrl, id: 'Recap', inputProps: data });
  let lastShown = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: out,
    inputProps: data,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct === lastShown) return;
      lastShown = pct;
      process.stdout.write(`\rrendering ${pct}%`);
    },
  });
  const meta = await getVideoMetadata(out);
  console.log(
    `\n${out}\n${meta.width}x${meta.height}, ${meta.durationInSeconds?.toFixed(1) ?? '?'} s, ${meta.fps} fps, ${meta.codec}`,
  );
} finally {
  await close();
}
