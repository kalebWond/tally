import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { LiveStandings } from '@/components/live-standings';
import { getContest, getEntrants } from '@/lib/contests';
import { serverEnv } from '@/lib/server-env';

export const metadata: Metadata = { title: 'Live results · Tally' };

export default async function ResultsPage(props: PageProps<'/results/[contestId]'>) {
  const { contestId } = await props.params;
  if (!z.uuid().safeParse(contestId).success) notFound();

  // Request time, not build time: the gateway URL comes from this environment.
  await connection();
  const [contest, entrants] = await Promise.all([getContest(contestId), getEntrants(contestId)]);
  if (!contest) notFound();

  return (
    <LiveStandings
      contest={{ ...contest, opensAt: contest.opensAt?.toISOString() ?? null }}
      entrants={entrants}
      gatewayUrl={serverEnv().GATEWAY_PUBLIC_URL}
      initialLayout={(await props.searchParams).view === 'grid' ? 'grid' : 'list'}
    />
  );
}
