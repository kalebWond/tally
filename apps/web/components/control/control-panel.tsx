'use client';

import type { GeneratorStatus } from '@tally/contracts';
import { ExternalLink } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { RateChart } from './rate-chart';
import { useGenerator } from './use-generator';

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
  const { status, reachable, history, error, busy, act } = useGenerator();
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
  const bursting = running && status?.burstEndsAt != null;
  const state =
    !reachable || !status ? 'Unreachable' : bursting ? 'Burst' : running ? 'Running' : 'Stopped';
  const activeContest = running ? (status?.contestId ?? contestId) : contestId;
  const delivered = history.at(-1)?.actual ?? null;

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 lg:py-12">
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

      {error && (
        <p
          role="alert"
          data-testid="control-error"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}
      {!reachable && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          The generator isn't answering. Start it with{' '}
          <code>docker compose --profile app up -d</code>; this page keeps checking.
        </p>
      )}

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
                    {contests.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} <span className="text-muted-foreground">· {c.status}</span>
                      </SelectItem>
                    ))}
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

              <div className="flex gap-3">
                {running ? (
                  <Button
                    data-testid="set-rate"
                    className="flex-1"
                    disabled={busy !== null || rate === status?.baseRate}
                    onClick={() => act('rate', { ratePerSec: rate })}
                  >
                    Set rate
                  </Button>
                ) : (
                  <Button
                    data-testid="start"
                    className="flex-1"
                    disabled={busy !== null || !reachable || !contestId}
                    onClick={() =>
                      act('start', {
                        contestId,
                        ratePerSec: rate,
                        invalidCodeRatio: invalidPct / 100,
                        duplicateSenderRatio: duplicatePct / 100,
                      })
                    }
                  >
                    Start
                  </Button>
                )}
                <Button
                  data-testid="stop"
                  variant="destructive"
                  className="flex-1"
                  disabled={busy !== null || !running}
                  onClick={() => act('stop')}
                >
                  Stop
                </Button>
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
}) {
  const { name, label, value, unit = '', digits = 0, alert } = props;
  const known = value !== null && value !== undefined;
  return (
    <div
      data-stat={name}
      data-value={known ? value : ''}
      className="rounded-lg border bg-muted/40 px-3 py-2"
    >
      <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      <div
        className={`font-heading text-2xl font-semibold tabular-nums ${alert && known && value > 0 ? 'text-destructive' : ''}`}
      >
        {known
          ? `${value.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`
          : '—'}
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
      <Badge data-testid="state" className={`h-7 px-3 text-sm font-semibold uppercase ${tone}`}>
        {state}
      </Badge>
      {state === 'Burst' && left !== null && (
        <span data-testid="burst-countdown" className="text-sm tabular-nums text-muted-foreground">
          {left}s left
        </span>
      )}
    </div>
  );
}
