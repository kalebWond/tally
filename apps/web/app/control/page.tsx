import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AdminNav } from '@/components/admin/admin-nav';
import { ControlPanel } from '@/components/control/control-panel';
import { requireAdmin } from '@/lib/auth';
import { getContests, getCurrentContestId } from '@/lib/contests';

export const metadata: Metadata = { title: 'Generator control · Tally' };

export default async function ControlPage() {
  await connection();
  await requireAdmin('/control');
  const [contests, currentId] = await Promise.all([getContests(), getCurrentContestId()]);
  return (
    <>
      <AdminNav current="/control" />
      <ControlPanel contests={contests} defaultContestId={currentId} />
    </>
  );
}
