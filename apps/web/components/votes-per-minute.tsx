'use client';

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { minuteSeries } from '@/lib/standings';

const fmt = new Intl.NumberFormat('en');
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The contest's votes per minute over the last 30 minutes (F17). Only rendered once the first
 * snapshot arrives, so times are always the viewer's clock, never the server's. Animation is
 * off: the latest minute changes several times a second, and re-animating would stutter.
 */
export function VotesPerMinute(props: {
  minutes: ReadonlyMap<number, number>;
  minutesTo: number;
  opensAt: number | null;
  live: boolean;
}) {
  const { minutes, minutesTo, opensAt, live } = props;
  const data = minuteSeries(minutes, minutesTo, opensAt);
  const inWindow = data.reduce((s, p) => s + p.count, 0);
  return (
    <section className="board-chart" aria-label="Votes per minute" data-testid="minute-chart">
      <header className="board-chart-head">
        <h2>Votes per minute</h2>
        <span data-testid="minute-chart-sum" data-value={inWindow}>
          {fmt.format(inWindow)} in the last {data.length} min
          {live ? ' · this minute still counting' : ''}
        </span>
      </header>
      <div className="board-chart-plot">
        <AreaChart
          responsive
          data={data}
          margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
          style={{ width: '100%', height: '100%' }}
        >
          <defs>
            <linearGradient id="vpm-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--live)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--live)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="minute"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={clock}
            stroke="var(--ink-dim)"
            fontSize={12}
            minTickGap={40}
          />
          <YAxis
            width={48}
            stroke="var(--ink-dim)"
            fontSize={12}
            tickFormatter={(v: number) => fmt.format(v)}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--raised)',
              border: '1px solid var(--line)',
              borderRadius: 4,
            }}
            labelFormatter={(m) => clock(Number(m))}
            formatter={(v) => [`${fmt.format(Number(v))} votes`, 'Votes']}
          />
          <Area
            dataKey="count"
            type="monotone"
            stroke="var(--live)"
            strokeWidth={2}
            fill="url(#vpm-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </div>
    </section>
  );
}
