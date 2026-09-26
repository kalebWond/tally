'use client';

import type { GeneratorStatus, LiveBacklog } from '@tally/contracts';
import { ExternalLink, Play, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ContestOptions } from '@/components/admin/contest-options';
import { AnimatedNumber } from '@/components/animated-number';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { timeLeft } from '@/lib/backlog-text';
import { drainShare } from '@/lib/liveliness';
import { EXIT, EXPAND, GENTLE, SMOOTH, SNAPPY } from '@/lib/motion';
import { RateChart } from './rate-chart';
import { useGenerator } from './use-generator';

/** How long the run toggle ignores clicks after changing between Start and Stop. */
const TOGGLE_GUARD_MS = 600;

type Contest = { id: string; name: string; status: string };

const MAX_RATE = 20_000;
const clampInt = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(v || 0)));

export function ControlPanel({
  contests,
  defaultContestId,
}: {
  contests: Contest[];
  defaultContestId?: string | undefined;
}) {
  const { status, reachable, history, error, busy, act, backlog } = useGenerator();
  const [contestId, setContestId] = useState(defaultContestId ?? '');
  const [rate, setRate] = useState(500);
  const [invalidPct, setInvalidPct] = useState(5);
  const [duplicatePct, setDuplicatePct] = useState(10);
  const [burstRate, setBurstRate] = useState(3000);
  const [burstSec, setBurstSec] = useState(10);

  // Opened mid-run: show the run's settings, not the defaults.
  const adopted = useRef(false);
  useEffect(() => {
    if (!status || adopted.current) return;
    adopted.current = true;
    if (status.running) setRate(status.baseRate);
  }, [status]);

  const running = status?.running ?? false;
  // Start and Stop are one button, and it changes role as soon as the request returns, tens of
  // milliseconds later. A double-click's second click lands after that: ignore clicks for a moment
  // after each change, so a habitual double-click can't start a run and stop it again.
  const toggledAt = useRef(Number.NEGATIVE_INFINITY);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    toggledAt.current = performance.now();
  }, [running]);
  const bursting = running && status?.burstEndsAt != null;
  const state =
    !reachable || !status ? 'Unreachable' : bursting ? 'Burst' : running ? 'Running' : 'Stopped';
  const activeContest = running ? (status?.contestId ?? contestId) : contestId;
  const delivered = history.at(-1)?.actual ?? null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-muted-foreground uppercase">
            Tally · operator
          </p>
          <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">
            Generator control
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <StateBadge state={state} endsAt={status?.burstEndsAt ?? null} />
          {activeContest && (
            <Button variant="outline" asChild>
              <a href={`/results/${activeContest}`} target="_blank" rel="noreferrer">
                Results <ExternalLink />
              </a>
            </Button>
          )}
        </div>
      </header>

      <AnimatePresence>
        {error && (
          <motion.div key="error" {...EXPAND} className="overflow-hidden">
            <p
              role="alert"
              data-testid="control-error"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
            >
              {error}
            </p>
          </motion.div>
        )}
        {!reachable && (
          <motion.div key="unreachable" {...EXPAND} className="overflow-hidden">
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
              The generator isn't answering. Start it with{' '}
              <code>docker compose --profile app up -d</code>; this page keeps checking.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Run</CardTitle>
              <CardDescription>
                Start sends votes at the chosen rate. While running, “Set rate” ramps without
                resetting the counters.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field label="Contest" htmlFor="contest">
                <Select value={activeContest} onValueChange={setContestId} disabled={running}>
                  <SelectTrigger id="contest" className="w-full">
                    <SelectValue placeholder="Choose a contest" />
                  </SelectTrigger>
                  <SelectContent>
                    <ContestOptions contests={contests} />
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Rate (votes/s)" htmlFor="rate">
                <div className="grid grid-cols-[1fr_7rem] items-center gap-3">
                  <Slider
                    min={100}
                    max={10_000}
                    step={100}
                    value={[Math.min(rate, 10_000)]}
                    onValueChange={([v]) => v !== undefined && setRate(v)}
                    aria-label="Rate"
                  />
                  <Input
                    id="rate"
                    data-testid="rate-input"
                    type="number"
                    min={1}
                    max={MAX_RATE}
                    value={rate}
                    onChange={(e) => setRate(clampInt(e.target.valueAsNumber, 1, MAX_RATE))}
                  />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Invalid codes %" htmlFor="invalid">
                  <Input
                    id="invalid"
                    data-testid="invalid-input"
                    type="number"
                    min={0}
                    max={100}
                    value={invalidPct}
                    disabled={running}
                    onChange={(e) => setInvalidPct(clampInt(e.target.valueAsNumber, 0, 100))}
                  />
                </Field>
                <Field label="Repeat senders %" htmlFor="duplicate">
                  <Input
                    id="duplicate"
                    data-testid="duplicate-input"
                    type="number"
                    min={0}
                    max={100}
                    value={duplicatePct}
                    disabled={running}
                    onChange={(e) => setDuplicatePct(clampInt(e.target.valueAsNumber, 0, 100))}
                  />
                </Field>
              </div>

              {/* Start becomes Stop (F31): one button that changes colour and word and makes
                  room for "Set rate" beside it, so the control you just pressed is still under
                  your pointer, now offering the way back. */}
              <div className="flex gap-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {running && (
                    <motion.div
                      key="set-rate"
                      className="flex-1"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1, transition: GENTLE }}
                      exit={{ opacity: 0, scale: 0.9, transition: EXIT }}
                    >
                      <Button
                        data-testid="set-rate"
                        className="w-full"
                        disabled={busy !== null || rate === status?.baseRate}
                        onClick={() => act('rate', { ratePerSec: rate })}
                      >
                        Set rate
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.div layout transition={SMOOTH} className="flex-1">
                  <Button
                    data-testid={running ? 'stop' : 'start'}
                    data-run-toggle
                    variant={running ? 'destructive' : 'default'}
                    className="w-full overflow-hidden"
                    disabled={busy !== null || (!running && (!reachable || !contestId))}
                    onClick={() => {
                      if (performance.now() - toggledAt.current < TOGGLE_GUARD_MS) return;
                      if (running) act('stop');
                      else
                        act('start', {
                          contestId,
                          ratePerSec: rate,
                          invalidCodeRatio: invalidPct / 100,
                          duplicateSenderRatio: duplicatePct / 100,
                        });
                    }}
                  >
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={running ? 'stop' : 'start'}
                        className="inline-flex items-center gap-1.5"
                        initial={{ opacity: 0, y: running ? 10 : -10 }}
                        animate={{ opacity: 1, y: 0, transition: SNAPPY }}
                        exit={{ opacity: 0, y: running ? -10 : 10, transition: EXIT }}
                      >
                        {running ? <Square /> : <Play />}
                        {running ? 'Stop' : 'Start'}
                      </motion.span>
                    </AnimatePresence>
                  </Button>
                </motion.div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Burst</CardTitle>
              <CardDescription>
                Raises the rate for a while, then falls back to the run's rate by itself.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rate (votes/s)" htmlFor="burst-rate">
                  <Input
                    id="burst-rate"
                    data-testid="burst-rate"
                    type="number"
                    min={1}
                    max={MAX_RATE}
                    value={burstRate}
                    onChange={(e) => setBurstRate(clampInt(e.target.valueAsNumber, 1, MAX_RATE))}
                  />
                </Field>
                <Field label="Seconds" htmlFor="burst-sec">
                  <Input
                    id="burst-sec"
                    data-testid="burst-duration"
                    type="number"
                    min={1}
                    max={600}
                    value={burstSec}
                    onChange={(e) => setBurstSec(clampInt(e.target.valueAsNumber, 1, 600))}
                  />
                </Field>
              </div>
              <Button
                data-testid="burst"
                variant="secondary"
                disabled={busy !== null || !running}
                onClick={() => act('burst', { ratePerSec: burstRate, durationSec: burstSec })}
              >
                {bursting ? 'Restart burst' : 'Trigger burst'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Throughput</CardTitle>
              <CardDescription>
                Votes per second over the last minute: asked for (dashed) and delivered to ingest.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <Stat name="currentRate" label="Target" value={status?.currentRate} unit="/s" />
                <Stat name="delivered" label="Delivered" value={delivered} unit="/s" />
                <Stat
                  name="baseRate"
                  label="Run rate"
                  value={running ? status?.baseRate : null}
                  unit="/s"
                />
              </div>
              <RateChart points={history} />
            </CardContent>
          </Card>

          <Card data-testid="backlog-card">
            <CardHeader>
              <CardTitle>Counting queue</CardTitle>
              <CardDescription data-testid="backlog-note">{backlogNote(backlog)}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <DrainBar pending={backlog?.pending ?? 0} />
              <Stat name="pending" label="Waiting" value={backlog?.pending} />
              <Stat name="perSec" label="Counting" value={backlog?.perSec} unit="/s" />
              <Stat
                name="etaSec"
                label="Time left"
                value={backlog?.etaSec}
                text={backlog ? (backlog.pending === 0 ? 'Done' : timeLeft(backlog.etaSec)) : null}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Counters</CardTitle>
              <CardDescription>{countersNote(status)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Stat name="sentTotal" label="Sent" value={status?.sentTotal} />
              <Stat name="accepted" label="Accepted (202)" value={status?.accepted} />
              <Stat name="rejected" label="Rejected" value={status?.rejected} alert />
              <Stat name="failed" label="No answer" value={status?.failed} alert />
              <Stat name="invalidSent" label="Invalid codes" value={status?.invalidSent} />
              <Stat name="duplicateSent" label="Repeat senders" value={status?.duplicateSent} />
              <Stat
                name="p50"
                label="Ingest p50"
                value={status?.latencyMs?.p50}
                unit=" ms"
                digits={1}
              />
              <Stat
                name="p95"
                label="Ingest p95"
                value={status?.latencyMs?.p95}
                unit=" ms"
                digits={1}
              />
              <Stat
                name="p99"
                label="Ingest p99"
                value={status?.latencyMs?.p99}
                unit=" ms"
                digits={1}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

/** Votes accepted but not yet counted (F29): the queue is shared by every contest. */
function backlogNote(backlog: LiveBacklog | undefined) {
  if (backlog === undefined) return 'Reading the queue…';
  if (backlog === null)
    return 'Counting paused: no consumer is reporting, so the queue can’t be measured.';
  if (backlog.pending === 0)
    return 'All counted. Votes accepted but not yet counted, across all contests.';
  return 'Votes accepted but not yet counted, across all contests. Totals keep rising until this reaches 0.';
}

function countersNote(status: GeneratorStatus | null) {
  if (status?.running && status.startedAt) {
    return `This run, since ${new Date(status.startedAt).toLocaleTimeString()}.`;
  }
  // A stopped generator keeps the last run's counters but not its start time.
  return status?.sentTotal ? 'Last run. Starting a new one resets them.' : 'No run yet.';
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Stat(props: {
  name: string;
  label: string;
  value: number | null | undefined;
  unit?: string;
  digits?: number;
  alert?: boolean;
  /** Shown instead of the formatted number, when set. */
  text?: string | null;
}) {
  const { name, label, value, unit = '', digits = 0, alert, text } = props;
  const known = value !== null && value !== undefined;
  return (
    <div
      data-stat={name}
      data-value={known ? value : ''}
      className="rounded-lg border bg-muted/40 px-3 py-2"
    >
      <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      <div
        className={`font-heading text-2xl font-semibold tabular-nums transition-colors ${alert && known && value > 0 ? 'text-destructive' : ''}`}
      >
        {/* Figures tick toward each new reading like the results board's counters (F31). */}
        {text ? text : known ? <AnimatedNumber value={value} digits={digits} unit={unit} /> : '—'}
      </div>
    </div>
  );
}

function StateBadge({ state, endsAt }: { state: string; endsAt: number | null }) {
  const tone =
    state === 'Burst'
      ? 'bg-warn text-black'
      : state === 'Running'
        ? 'bg-live text-white'
        : state === 'Unreachable'
          ? 'bg-destructive/20 text-destructive'
          : 'bg-muted text-muted-foreground';
  const left = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null;
  return (
    <div className="flex items-center gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={state}
          className="inline-flex"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1, transition: SNAPPY }}
          exit={{ opacity: 0, scale: 0.85, transition: EXIT }}
        >
          <Badge data-testid="state" className={`h-7 px-3 text-sm font-semibold uppercase ${tone}`}>
            {state}
          </Badge>
        </motion.span>
      </AnimatePresence>
      {state === 'Burst' && left !== null && (
        <span data-testid="burst-countdown" className="text-sm tabular-nums text-muted-foreground">
          {left}s left
        </span>
      )}
    </div>
  );
}

/**
 * The queue as a bar (F31): full at the most that has waited since it was last empty, draining
 * to nothing as votes are counted, so "still counting" reads at a glance.
 */
function DrainBar({ pending }: { pending: number }) {
  const [peak, setPeak] = useState(0);
  const { share, peak: next } = drainShare(pending, peak);
  if (next !== peak) setPeak(next);
  return (
    <div
      className="col-span-3 h-1.5 overflow-hidden rounded-full bg-muted"
      data-testid="backlog-bar"
      data-share={share.toFixed(3)}
      aria-hidden
    >
      <motion.div
        className="h-full origin-left rounded-full bg-warn"
        initial={false}
        animate={{ scaleX: share }}
        transition={SMOOTH}
      />
    </div>
  );
}
