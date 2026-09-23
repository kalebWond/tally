'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { type Entrant, rank, unknownIds } from '@/lib/standings';
import { ContestantRow } from './contestant-row';
import { type ConnectionState, useLiveTotals } from './use-live-totals';

interface Props {
  contest: { id: string; name: string; status: string };
  entrants: Entrant[];
  gatewayUrl: string;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  offline: 'Offline',
};

/** How often, at most, to re-fetch contestant details when an unknown id shows up. */
const REFRESH_COOLDOWN_MS = 5000;

export function LiveStandings({ contest, entrants, gatewayUrl }: Props) {
  const { totals, totalVotes, connection, synced } = useLiveTotals(gatewayUrl, contest.id);
  const standings = useMemo(() => rank(entrants, totals), [entrants, totals]);

  // A contestant added after load (F14) has totals but no details: re-run the server
  // component to fetch them. Client state, including the live totals, survives the refresh.
  const router = useRouter();
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (unknownIds(entrants, totals).length === 0) return;
    if (Date.now() - lastRefresh.current < REFRESH_COOLDOWN_MS) return;
    lastRefresh.current = Date.now();
    router.refresh();
  }, [entrants, totals, router]);

  return (
    <main className="board">
      <header className="board-head">
        <div className="board-title">
          <span className="board-status" data-state={connection}>
            {STATUS_LABEL[connection]}
          </span>
          <h1>{contest.name}</h1>
        </div>
        <div className="board-count">
          <span className="board-count-value" data-testid="total-votes">
            {synced ? totalVotes.toLocaleString('en') : '–'}
          </span>
          <span className="board-count-label">votes</span>
        </div>
      </header>

      <ol className="board-rows" aria-label="Standings">
        {standings.map((s, i) => (
          <ContestantRow key={s.id} standing={s} synced={synced} leader={i === 0 && s.total > 0} />
        ))}
      </ol>

      <footer className="board-foot">Send the contestant code to vote. Updated live.</footer>
    </main>
  );
}
