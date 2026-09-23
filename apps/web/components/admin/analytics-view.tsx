'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Analytics } from '@/lib/analytics';
import { ContestPicker } from './contest-picker';

const REFRESH_MS = 15_000;
const LINE_COLOURS = ['#4cc2ff', '#ff3d4f', '#f5b041', '#22c55e', '#a855f7'];
const n = new Intl.NumberFormat('en');
const time = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const dayTime = (ms: number) =>
  new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const axis = { stroke: 'var(--ink-dim)', fontSize: 12 };
const tooltip = { background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8 };

export function AnalyticsView(props: {
  contests: { id: string; name: string; status: string }[];
  contestId: string | undefined;
  names: Record<string, string>;
  labelsAvailable: boolean;
}) {
  const { contests, contestId, names, labelsAvailable } = props;
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (!contestId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`/api/analytics/${contestId}`, { cache: 'no-store' });
        const json = await res.json();
        if (res.ok) {
          setData(json as Analytics);
          setError(null);
          setUpdated(Date.now());
        } else setError(json.issues?.[0]?.message ?? `HTTP ${res.status}`);
      } catch {
        setError('Could not reach the web server.');
      }
      if (!stopped) timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [contestId]);

  const label = (code: string) => (names[code] ? `${names[code]} (${code})` : code);
  const finals = data?.history.at(-1)?.totals ?? {};
  const top = Object.entries(finals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code]) => code);
  const history = data?.history.map((h) => ({ minute: h.minute, ...h.totals })) ?? [];

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8" data-testid="analytics">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-muted-foreground uppercase">
            Tally · analytics
          </p>
          <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            From ClickHouse (a separate consumer group); never touches Postgres. Refreshes every 15
            s.
          </p>
        </div>
        {contests.length > 0 && contestId && (
          <ContestPicker contests={contests} value={contestId} basePath="/admin/analytics" />
        )}
      </header>

      {!labelsAvailable && (
        <p
          className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm"
          data-testid="labels-missing"
        >
          Postgres is unreachable, so contestants show by code. Every number below comes from
          ClickHouse.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}
      {!contestId && <p className="text-muted-foreground">No contest to analyse.</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile name="counted" label="Votes counted" value={n.format(data.counted)} />
            <Tile name="rejected" label="Rejected" value={n.format(data.rejected)} />
            <Tile
              name="lead-changes"
              label="Lead changes"
              value={n.format(data.leadChanges.length)}
            />
            <Tile
              name="leader"
              label="Leading now"
              value={data.leadChanges.at(-1) ? label(data.leadChanges.at(-1)?.leader ?? '') : '—'}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Turnout</CardTitle>
              <CardDescription>
                Votes per {data.bucketMinutes === 1 ? 'minute' : `${data.bucketMinutes} minutes`},
                counted and rejected, by when ingest accepted them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64" data-testid="turnout-chart" data-points={data.turnout.length}>
                <BarChart responsive data={data.turnout} style={{ width: '100%', height: '100%' }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="bucket" tickFormatter={dayTime} {...axis} minTickGap={40} />
                  <YAxis width={64} tickFormatter={(v: number) => n.format(v)} {...axis} />
                  <Tooltip
                    contentStyle={tooltip}
                    labelFormatter={(v) => dayTime(Number(v))}
                    formatter={(v, k) => [n.format(Number(v)), k]}
                  />
                  <Legend />
                  <Bar
                    dataKey="counted"
                    name="Counted"
                    stackId="t"
                    fill="var(--chart-1)"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="rejected"
                    name="Rejected"
                    stackId="t"
                    fill="var(--warn)"
                    isAnimationActive={false}
                  />
                </BarChart>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader>
                <CardTitle>Lead-change history</CardTitle>
                <CardDescription>
                  Cumulative votes for the top five; each dashed line is a change of leader.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72" data-testid="history-chart">
                  <LineChart responsive data={history} style={{ width: '100%', height: '100%' }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="minute"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={dayTime}
                      {...axis}
                      minTickGap={40}
                    />
                    <YAxis width={64} tickFormatter={(v: number) => n.format(v)} {...axis} />
                    <Tooltip
                      contentStyle={tooltip}
                      labelFormatter={(v) => dayTime(Number(v))}
                      formatter={(v, k) => [n.format(Number(v)), label(String(k))]}
                    />
                    {data.leadChanges.map((c) => (
                      <ReferenceLine
                        key={c.minute}
                        x={c.minute}
                        stroke="var(--ink-dim)"
                        strokeDasharray="3 4"
                      />
                    ))}
                    {top.map((code, i) => (
                      <Line
                        key={code}
                        dataKey={code}
                        name={code}
                        stroke={LINE_COLOURS[i % LINE_COLOURS.length] ?? 'var(--chart-1)'}
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lead changes</CardTitle>
                <CardDescription>Most recent first, by minute.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-80 overflow-y-auto p-0">
                <Table data-testid="lead-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>New leader</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data.leadChanges].reverse().map((c) => (
                      <TableRow key={c.minute}>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {dayTime(c.minute)}
                        </TableCell>
                        <TableCell>
                          {c.leader}
                          {c.previous && (
                            <span className="text-muted-foreground"> over {c.previous}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          +{n.format(c.margin)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By source</CardTitle>
                <CardDescription>Counted votes by the channel they arrived on.</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="h-56"
                  data-testid="source-chart"
                  data-sources={data.bySource.map((s) => `${s.source}:${s.votes}`).join(',')}
                >
                  <BarChart
                    responsive
                    layout="vertical"
                    data={data.bySource}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <CartesianGrid stroke="var(--line)" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v: number) => n.format(v)} {...axis} />
                    <YAxis type="category" dataKey="source" width={80} {...axis} />
                    <Tooltip
                      contentStyle={tooltip}
                      formatter={(v) => [n.format(Number(v)), 'Votes']}
                    />
                    <Bar dataKey="votes" fill="var(--chart-1)" isAnimationActive={false} />
                  </BarChart>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Rejected, by reason</CardTitle>
                <CardDescription>Dead letters for this contest.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {data.byReason.length === 0 && <p className="text-muted-foreground">None.</p>}
                {data.byReason.map((r) => (
                  <div
                    key={r.reason}
                    className="flex justify-between border-b py-2 text-sm last:border-0"
                  >
                    <span>{r.reason.replaceAll('_', ' ')}</span>
                    <span className="tabular-nums">{n.format(r.votes)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground" data-testid="served">
            Served from ClickHouse in {data.queryMs} ms
            {updated ? ` · updated ${time(updated)}` : ''}.
          </p>
        </>
      )}
    </main>
  );
}

function Tile({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <div data-stat={name} className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="font-heading text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
