import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getCurrentContestId } from '@/lib/contests';

export default async function Home() {
  await connection();
  const contestId = await getCurrentContestId();
  if (!contestId) notFound();
  redirect(`/results/${contestId}`);
}
