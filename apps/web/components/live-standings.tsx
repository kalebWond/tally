'use client';

import type { ContestStatus } from '@tally/contracts';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { backlogParts } from '@/lib/backlog-text';
import { advance, cueOf, initialLighting, type Lighting, nextChangeAt } from '@/lib/lighting';
import { APPEAR, SNAPPY } from '@/lib/motion';
import { type Movement, movements } from '@/lib/movement';
import { type Entrant, rank, titleSize, unknownIds } from '@/lib/standings';
import { AnimatedNumber } from './animated-number';
import { ContestantRow, type Layout } from './contestant-row';
import { LiveDot, useTotalSamples } from './live-dot';
import { HOUSE_COLOURS, Stage } from './stage/stage';
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
/** How long a row keeps its overtake treatment (lifted above the pack, glowing edge). */
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

/**
 * The stage lighting (F32), advanced on every change of status or of who is first, and again
 * when a hold or a spotlight runs out. Starts from the first snapshot: before it, who leads is
 * unknown.
 */
function useLighting(
  status: ContestStatus,
  leaders: readonly string[],
  counted: boolean,
  synced: boolean,
) {
  const [lighting, setLighting] = useState<Lighting>(initialLighting);
  const key = leaders.join(',');
  useEffect(() => {
    if (!synced) return;
    const input = { status, leaders: key ? key.split(',') : [], counted };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      setLighting((l) => {
        const next = advance(l, input, performance.now());
        const at = nextChangeAt(next);
        clearTimeout(timer);
        if (at !== null) timer = setTimeout(step, Math.max(0, at - performance.now()) + 20);
        return next;
      });
    };
    step();
    return () => clearTimeout(timer);
  }, [status, key, counted, synced]);
  return lighting;
}

/** How long the pointer must rest before the operator's controls fade from the picture. */
const IDLE_MS = 3000;

/**
 * Whether the pointer has rested and the keyboard been quiet for IDLE_MS (F32): the layout
 * toggle is for whoever runs the screen, so it steps out of a projector or a recording until
 * someone reaches for it.
 */
function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [ms]);
  return idle;
}

/**
 * Whether the header is pinned over the list (F31): it sticks on screens with room for it, and
 * only then turns into a translucent bar with a soft edge where the rows pass under it.
 */
function useStuck() {
  const ref = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      setStuck(getComputedStyle(el).position === 'sticky' && el.getBoundingClientRect().top <= 0.5);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return [ref, stuck] as const;
}

export function LiveStandings({ contest, entrants, gatewayUrl, initialLayout }: Props) {
  const [layout, setLayout] = useState<Layout>(initialLayout);
  // Kept in the URL without a navigation: no server round trip, and the live socket stays open.
  const switchLayout = (next: Layout) => {
    setLayout(next);
    const url = new URL(window.location.href);
    if (next === 'list') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  };
  const { totals, totalVotes, status, minutes, minutesTo, backlog, connection, synced, retryAt } =
    useLiveTotals(gatewayUrl, contest.id);
  // Votes still in the queue (F29). Shown only while the connection is live: stale numbers hide.
  const counting = connection === 'live' ? backlogParts(backlog) : null;
  const [headRef, stuck] = useStuck();
  const idle = useIdle(IDLE_MS);
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
  const samples = useTotalSamples(totalVotes, synced);
  const leaders = useMemo(
    () => standings.filter((s) => s.rank === 1 && s.total > 0).map((s) => s.id),
    [standings],
  );
  // Every vote accepted so far is counted (F39): the finale waits for it after the close. The
  // queue is shared by all contests; unknown (no consumer reporting) counts as not yet.
  const counted = backlog !== null && backlog.pending === 0;
  const lighting = useLighting(contestStatus, leaders, counted, synced);
  // Before the first snapshot the lighting knows nothing: light the stage for the status alone.
  const cue =
    lighting.status === null
      ? contestStatus === 'open'
        ? 'live'
        : contestStatus === 'closed'
          ? 'finale'
          : 'dark'
      : cueOf(lighting);
  const lit = entrants.find((e) => e.id === lighting.shown);
  const colours = useMemo(
    () =>
      lit
        ? { from: lit.accentFrom ?? HOUSE_COLOURS.from, to: lit.accentTo ?? HOUSE_COLOURS.to }
        : HOUSE_COLOURS,
    [lit],
  );
  // Only a lead change aims the beams, both crossing on the new leader. The finale doesn't aim:
  // the beams wander (F39).
  const aimCode =
    cue === 'spotlight'
      ? entrants.find((e) => e.id === lighting.spotlight?.target)?.code
      : undefined;

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
    // Reduced-motion users get instant reorders and counters (MotionPreferences, root layout).
    <main
      className="board"
      data-stale={stale || undefined}
      data-contest={contestStatus}
      style={{ '--stage-glow': colours.from } as CSSProperties}
    >
      <Stage
        colours={colours}
        cue={cue}
        aimAt={aimCode ?? null}
        settled={lighting.finale === 'settled' || lighting.status === null}
        samples={samples}
      />
      <header ref={headRef} className="board-head" data-stuck={stuck || undefined}>
        <div className="board-title">
          <span className="board-status" data-state={pill}>
            <LiveDot beating={pill === 'live'} samples={samples} />
            {STATUS_LABEL[pill]}
          </span>
          <h1 data-size={titleSize(contest.name)} title={contest.name}>
            {contest.name}
          </h1>
        </div>
        <div className="board-side">
          <fieldset className="board-layout" data-idle={idle || undefined}>
            <legend className="sr-only">Layout</legend>
            {(['list', 'grid'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                data-testid={`layout-${l}`}
                onClick={() => switchLayout(l)}
              >
                {layout === l && (
                  <motion.span
                    layoutId="layout-pill"
                    className="board-layout-pill"
                    transition={SNAPPY}
                  />
                )}
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
            <span className="board-count-label">votes cast</span>
            <AnimatePresence>
              {counting && (
                <motion.span
                  className="board-backlog"
                  data-testid="backlog"
                  title="Votes accepted but not yet counted, across all live contests."
                  {...APPEAR}
                >
                  Counting <AnimatedNumber value={counting.pending} /> {counting.rest}
                </motion.span>
              )}
            </AnimatePresence>
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
            index={i}
            synced={synced}
            leader={i === 0 && s.total > 0}
            podium={i < 3 && s.total > 0 ? (s.rank as 1 | 2 | 3) : undefined}
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
  );
}
