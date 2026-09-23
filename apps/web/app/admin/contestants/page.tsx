import type { Metadata } from 'next';
import { connection } from 'next/server';
import { z } from 'zod';
import { AdminNav } from '@/components/admin/admin-nav';
import { ContestantsAdmin } from '@/components/admin/contestants-admin';
import { listContestants } from '@/lib/admin-contestants';
import { requireAdmin } from '@/lib/auth';
import { getContests, getCurrentContestId } from '@/lib/contests';

export const metadata: Metadata = { title: 'Contestants · Tally' };

export default async function ContestantsPage(props: PageProps<'/admin/contestants'>) {
  await connection();
  await requireAdmin('/admin/contestants');

  const asked = z.uuid().safeParse((await props.searchParams).contest);
  const contests = await getContests();
  const contestId =
    asked.success && contests.some((c) => c.id === asked.data)
      ? asked.data
      : await getCurrentContestId();
  const contestants = contestId ? await listContestants(contestId) : [];

  return (
    <>
      <AdminNav current="/admin/contestants" />
      <ContestantsAdmin contests={contests} contestId={contestId} contestants={contestants} />
    </>
  );
}
