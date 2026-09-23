import type { Metadata } from 'next';
import { connection } from 'next/server';
import { z } from 'zod';
import { AdminNav } from '@/components/admin/admin-nav';
import { AnalyticsView } from '@/components/admin/analytics-view';
import { latestContestId } from '@/lib/analytics';
import { requireAdmin } from '@/lib/auth';
import { getContests, getCurrentContestId, getEntrants } from '@/lib/contests';

export const metadata: Metadata = { title: 'Analytics · Tally' };

/**
 * Every chart's data comes from ClickHouse, via /api/analytics. Postgres only supplies labels
 * (contest and contestant names) and the page renders without them, so analytics keeps working
 * while the operational database is down.
 */
export default async function AnalyticsPage(props: PageProps<'/admin/analytics'>) {
  await connection();
  await requireAdmin('/admin/analytics');

  const asked = z.uuid().safeParse((await props.searchParams).contest);
  let contests: { id: string; name: string; status: string }[] = [];
  let names: Record<string, string> = {};
  let contestId = asked.success ? asked.data : undefined;
  let labelsAvailable = true;
  try {
    contests = await getContests();
    contestId ??= await getCurrentContestId();
    if (contestId)
      names = Object.fromEntries((await getEntrants(contestId)).map((e) => [e.code, e.name]));
  } catch {
    labelsAvailable = false; // Postgres unreachable: charts still load, labelled by code
    contestId ??= await latestContestId().catch(() => undefined);
  }

  return (
    <>
      <AdminNav current="/admin/analytics" />
      <AnalyticsView
        contests={contests}
        contestId={contestId}
        names={names}
        labelsAvailable={labelsAvailable}
      />
    </>
  );
}
