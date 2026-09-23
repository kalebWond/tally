'use client';

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { HISTORY_WINDOW_MS, type RatePoint } from '@/lib/rate-history';

const fmt = new Intl.NumberFormat('en');

/**
 * Asked-for rate against delivered rate over the last minute. Animation is off: points arrive
 * every second, and re-animating the whole line on each one would jitter.
 */
export function RateChart({ points }: { points: RatePoint[] }) {
  const now = points.at(-1)?.at ?? 0;
  const data = points.map((p) => ({ ...p, ago: (p.at - now) / 1000 }));
  return (
    <div data-testid="rate-chart" className="h-56 w-full">
      <LineChart
        responsive
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        style={{ width: '100%', height: '100%' }}
      >
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey="ago"
          type="number"
          domain={[-HISTORY_WINDOW_MS / 1000, 0]}
          ticks={[-60, -45, -30, -15, 0]}
          tickFormatter={(s: number) => (s === 0 ? 'now' : `${s}s`)}
          stroke="var(--ink-dim)"
          fontSize={12}
        />
        <YAxis
          width={52}
          stroke="var(--ink-dim)"
          fontSize={12}
          tickFormatter={(v: number) => fmt.format(v)}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--raised)',
            border: '1px solid var(--line)',
            borderRadius: 8,
          }}
          labelFormatter={(s) => `${Math.abs(Number(s)).toFixed(0)} s ago`}
          formatter={(v, name) => [`${fmt.format(Number(v))} votes/s`, name]}
        />
        <Line
          name="Target"
          dataKey="target"
          type="stepAfter"
          stroke="var(--ink-dim)"
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          name="Delivered"
          dataKey="actual"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
