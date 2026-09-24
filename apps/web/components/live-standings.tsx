'use client';

import type { ContestStatus } from '@tally/contracts';
import { MotionConfig } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { backlogLine } from '@/lib/backlog-text';
import { type Movement, movements } from '@/lib/movement';
import { type Entrant, rank, unknownIds } from '@/lib/standings';
import { AnimatedNumber } from './animated-number';
import { ContestantRow, type Layout } from './contestant-row';
import { type ConnectionState, useLiveTotals } from './use-live-totals';
import { VotesPerMinute } from './votes-per-minute';

interface Props {
  contest: { id: string; name: string; status: ContestStatus; opensAt: string | null };
  entrants: Entrant[];
  gatewayUrl: string;
  /** From `?view=`, so a broadcast link can open straight into the grid. */
  initialLayout: Layout;
}

const STATUS_LABEL: Record<ConnectionState | 'final' | 'draft', string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  unavailable: 'Unavailable',
  final: 'Final',
  draft: 'Not open',
};

const FOOTER: Record<ContestStatus, string> = {
  open: 'Send the contestant code to vote. Updated live.',
  closed: 'Voting has closed. These are the final results.',
  draft: 'Voting has not opened yet.',
};

/** Seconds until `at`, re-rendered every second while there is something to count down to. */
function useSecondsUntil(at: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [at]);
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** Tells viewers the numbers are frozen, and what the page is doing about it. */
function StaleNote({
  connection,
  retryAt,
}: {
  connection: ConnectionState;
  retryAt: number | null;
}) {
  const seconds = useSecondsUntil(retryAt);
  const action =
    connection === 'offline'
      ? 'you are offline, will reconnect when the network returns'
      : connection === 'unavailable'
        ? 'this contest cannot be streamed'
        : seconds
          ? `reconnecting in ${seconds}s`
          : 'reconnecting…';
  return (
    <p className="board-stale" role="status">
      Showing last known totals · {action}
    </p>
  );
}

/** How often, at most, to re-fetch contestant details when an unknown id shows up. */
const REFRESH_COOLDOWN_MS = 5000;
/** How long a row keeps its overtake treatment (raised above the pack, glowing edge). */
const OVERTAKE_MS = 800;

/**
 * Rows that just changed position, for the overtake treatment. Each mark carries a token so
 * an older timer can't clear a newer overtake by the same row, and every mark expires, so a
 * storm of swaps can't leave a row stuck "rising".
 */
function useMovements(orderKey: string) {
  const [marks, setMarks] = useState<ReadonlyMap<string, { dir: Movement; token: number }>>(
    new Map(),
  );
  const previous = useRef<string[] | undefined>(undefined);
  const token = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const order = orderKey ? orderKey.split(',') : [];
    const moved = movements(previous.current, order);
    previous.current = order;
    if (moved.size === 0) return;

    const t = ++token.current;
    setMarks(
      (m) => new Map([...m, ...[...moved].map(([id, dir]) => [id, { dir, token: t }] as const)]),
    );
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setMarks((m) => new Map([...m].filter(([, mark]) => mark.token !== t)));
    }, OVERTAKE_MS);
    timers.current.add(timer);
  }, [orderKey]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  return marks;
}

export function LiveStandings({ contest, entrants, gatewayUrl, initialLayout }: Props) {
  const [layout, setLayout] = useState<Layout>(initialLayout);
  // Kept in the URL without a navigation: no server round trip, and the live socket stays open.
  const switchLayout = (next: Layout) => {
    setLayout(next);
    const url = new URL(window.location.href);
    if (next === 'list') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(window.history.state, '', url);
  };
  const { totals, totalVotes, status, minutes, minutesTo, backlog, connection, synced, retryAt } =
    useLiveTotals(gatewayUrl, contest.id);
  // Votes still in the queue (F29). Shown only while the connection is live: stale numbers hide.
  const counting = connection === 'live' ? backlogLine(backlog) : null;
  // The gateway's status (F16) wins, so a close shows without a reload; it is null when Redis
  // doesn't know, and then the status this page was rendered with stands.
  const contestStatus = status ?? contest.status;
  // Connection trouble outranks the contest's status: "Final" must not hide a dead connection.
  const pill =
    connection === 'live' && contestStatus !== 'open'
      ? contestStatus === 'closed'
        ? 'final'
        : 'draft'
      : connection;
  // Totals shown but not current: keep them visible, dimmed, with a note.
  const stale = synced && connection !== 'live';
  const standings = useMemo(() => rank(entrants, totals), [entrants, totals]);
  const moving = useMovements(standings.map((s) => s.id).join(','));

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
    // Reduced-motion users get instant reorders and counters.
    <MotionConfig reducedMotion="user">
      <main className="board" data-stale={stale || undefined} data-contest={contestStatus}>
        <header className="board-head">
          <div className="board-title">
            <span className="board-status" data-state={pill}>
              {STATUS_LABEL[pill]}
            </span>
            <h1>{contest.name}</h1>
          </div>
          <div className="board-side">
            <fieldset className="board-layout">
              <legend className="sr-only">Layout</legend>
              {(['list', 'grid'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  data-testid={`layout-${l}`}
                  onClick={() => switchLayout(l)}
                >
                  {l === 'list' ? 'List' : 'Grid'}
                </button>
              ))}
            </fieldset>
            <div className="board-count">
              {synced ? (
                <AnimatedNumber
                  className="board-count-value"
                  value={totalVotes}
                  data-testid="total-votes"
                />
              ) : (
                <span className="board-count-value">–</span>
              )}
              <span className="board-count-label">votes</span>
              {counting && (
                <span
                  className="board-backlog"
                  data-testid="backlog"
                  title="Votes accepted but not yet counted, across all live contests."
                >
                  {counting}
                </span>
              )}
            </div>
          </div>
        </header>

        {stale && <StaleNote connection={connection} retryAt={retryAt} />}

        <ol className="board-rows" data-layout={layout} aria-label="Standings">
          {standings.map((s, i) => (
            <ContestantRow
              key={s.id}
              standing={s}
              layout={layout}
              synced={synced}
              leader={i === 0 && s.total > 0}
              movement={moving.get(s.id)?.dir}
            />
          ))}
        </ol>

        {synced && minutesTo !== null && (
          <VotesPerMinute
            minutes={minutes}
            minutesTo={minutesTo}
            opensAt={contest.opensAt ? Date.parse(contest.opensAt) : null}
            live={contestStatus === 'open'}
          />
        )}

        <footer className="board-foot" data-testid="board-foot">
          {FOOTER[contestStatus]}
        </footer>
      </main>
    </MotionConfig>
  );
}
