import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AdminNav } from '@/components/admin/admin-nav';
import { ContestsAdmin } from '@/components/admin/contests-admin';
import { requireAdmin } from '@/lib/auth';
import { getActiveContestantCounts, getContests } from '@/lib/contests';

export const metadata: Metadata = { title: 'Contests · Tally' };

export default async function ContestsPage(props: PageProps<'/admin/contests'>) {
  await connection();
  await requireAdmin('/admin/contests');
  const [rows, contestantCounts] = await Promise.all([getContests(), getActiveContestantCounts()]);
  const contests = rows.map((c) => ({
    ...c,
    opensAt: c.opensAt?.toISOString() ?? null,
    closesAt: c.closesAt?.toISOString() ?? null,
  }));
  const asked = (await props.searchParams).status;
  const initialFilter =
    asked === 'open' || asked === 'draft' || asked === 'closed' ? asked : ('all' as const);
  return (
    <>
      <AdminNav current="/admin/contests" />
      <ContestsAdmin
        contests={contests}
        contestantCounts={contestantCounts}
        initialFilter={initialFilter}
      />
    </>
  );
}
