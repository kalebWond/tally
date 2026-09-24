import { exportRecap } from '@tally/recap-video/export';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { AdminNav } from '@/components/admin/admin-nav';
import { RecapPlayer } from '@/components/admin/recap-player';
import { requireAdmin } from '@/lib/auth';
import { getContest } from '@/lib/contests';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Recap · Tally' };

/**
 * The recap video (F25) played in the browser (F28): the same component and the same Postgres
 * export `pnpm recap` renders to an MP4, so the two can't drift. Loaded on the server when the
 * page loads; Refresh reloads it, which is what an open contest needs.
 */
export default async function RecapPage(props: PageProps<'/admin/recap/[contestId]'>) {
  const { contestId } = await props.params;
  await connection();
  await requireAdmin(`/admin/recap/${contestId}`);
  if (!z.uuid().safeParse(contestId).success || !(await getContest(contestId))) notFound();

  const data = await exportRecap(db(), contestId);
  return (
    <>
      <AdminNav current="/admin/contests" />
      <RecapPlayer data={data} loadedAt={new Date().toISOString()} />
    </>
  );
}
