import { loadFont as loadBody } from '@remotion/google-fonts/Barlow';
import { loadFont as loadDisplay } from '@remotion/google-fonts/BarlowCondensed';
import { type CSSProperties, useMemo } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { FPS, type RecapData, SECTIONS } from './data.ts';

// The scoreboard's look (apps/web globals.css): dark ground, Barlow Condensed display type.
const { fontFamily: display } = loadDisplay('normal', {
  weights: ['600', '700'],
  subsets: ['latin'],
});
const { fontFamily: body } = loadBody('normal', { weights: ['400', '500'], subsets: ['latin'] });
const INK = '#f3f5f9';
const DIM = '#8b93a5';
const GROUND = '#0a0c11';
const SURFACE = '#11151d';
const n = new Intl.NumberFormat('en');

const flag = (cc: string | null) =>
  cc && /^[A-Za-z]{2}$/.test(cc)
    ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)))
    : '';

export function Recap(data: RecapData) {
  const s = (k: keyof typeof SECTIONS) => SECTIONS[k] * FPS;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1400px 600px at 50% -160px, #1b2233 0%, transparent 70%), ${GROUND}`,
        color: INK,
        fontFamily: body,
      }}
    >
      <Sequence durationInFrames={s('intro')}>
        <Intro {...data} />
      </Sequence>
      <Sequence from={s('intro')} durationInFrames={s('race')}>
        <Race {...data} />
      </Sequence>
      <Sequence from={s('intro') + s('race')} durationInFrames={s('standings')}>
        <Standings {...data} />
      </Sequence>
      <Sequence from={s('intro') + s('race') + s('standings')} durationInFrames={s('winner')}>
        <Winner {...data} />
      </Sequence>
    </AbsoluteFill>
  );
}

const heading = (size: number): CSSProperties => ({
  fontFamily: display,
  fontWeight: 700,
  fontSize: size,
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
  lineHeight: 1,
});
const label: CSSProperties = {
  fontFamily: display,
  fontWeight: 600,
  fontSize: 28,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: DIM,
};

function Intro({ contest, totalVotes, contestants }: RecapData) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [SECTIONS.intro * fps - 12, SECTIONS.intro * fps], [1, 0], {
    extrapolateLeft: 'clamp',
  });
  const counted = Math.round(
    interpolate(frame, [15, 70], [0, totalVotes], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    }),
  );
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', gap: 36, opacity: fadeOut }}
    >
      <div style={{ ...label, opacity: rise }}>
        {contest.status === 'closed' ? 'Final results' : 'Results so far'}
      </div>
      <div
        style={{
          ...heading(150),
          transform: `translateY(${(1 - rise) * 40}px)`,
          opacity: rise,
          textAlign: 'center',
        }}
      >
        {contest.name}
      </div>
      <div style={{ ...heading(90), fontVariantNumeric: 'tabular-nums' }}>
        {n.format(counted)}{' '}
        <span style={{ ...label, fontSize: 36 }}>votes · {contestants.length} contestants</span>
      </div>
    </AbsoluteFill>
  );
}

/** Totals at frame `f` of the race: linear between history steps over `runFrames`, then held. */
function sampleAt(
  steps: RecapData['steps'],
  contestants: RecapData['contestants'],
  runFrames: number,
  f: number,
) {
  const last = Math.max(1, steps.length - 1);
  const pos = interpolate(f, [0, runFrames], [0, last], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const i = Math.floor(pos);
  const a = steps[i];
  const b = steps[Math.min(last, i + 1)];
  const t = pos - i;
  const totals: Record<string, number> = {};
  for (const c of contestants)
    totals[c.id] = (a?.totals[c.id] ?? 0) * (1 - t) + (b?.totals[c.id] ?? 0) * t;
  return { totals, minute: (a?.minute ?? 0) + ((b?.minute ?? 0) - (a?.minute ?? 0)) * t };
}

const ROW = 82;
const TOP = 210;

function Race({ contestants, steps }: RecapData) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The race runs over the first 90% of the section, then holds on the final totals.
  const runFrames = SECTIONS.race * fps * 0.9;
  const at = (f: number) => sampleAt(steps, contestants, runFrames, f);
  // Ranks for every frame, computed once from the start so each frame's answer is the same no
  // matter which frame renders first. Hysteresis: a bar only passes the one above it once it is
  // clearly ahead (0.5% and 2 votes), so near-ties don't flip every frame and park bars
  // half-way between slots. On the last frame the order is exact.
  const totalFrames = SECTIONS.race * fps;
  const ranks = useMemo(() => {
    const byFrame: Map<string, number>[] = [];
    let order = contestants.map((c) => c.id);
    for (let f = 0; f < totalFrames; f++) {
      const { totals } = sampleAt(steps, contestants, runFrames, f);
      const value = (id: string) => totals[id] ?? 0;
      const exact = f >= runFrames;
      for (let pass = 0; pass < order.length; pass++) {
        let swapped = false;
        for (let i = order.length - 1; i > 0; i--) {
          const above = order[i - 1] ?? '';
          const below = order[i] ?? '';
          const margin = exact ? 0 : Math.max(2, value(above) * 0.005);
          if (value(below) > value(above) + margin) {
            order[i - 1] = below;
            order[i] = above;
            swapped = true;
          }
        }
        if (!swapped) break;
      }
      order = [...order];
      byFrame.push(new Map(order.map((id, i) => [id, i])));
    }
    return byFrame;
  }, [steps, contestants, totalFrames, runFrames]);
  // A swap becomes a glide: each bar's slot is averaged over the last 10 frames' ranks.
  const window = Array.from(
    { length: 10 },
    (_, k) => ranks[Math.max(0, Math.min(ranks.length - 1, frame - k))] ?? new Map(),
  );
  const y = (id: string) =>
    (window.reduce((sum, m) => sum + (m.get(id) ?? 0), 0) / window.length) * ROW;
  const { totals, minute } = at(frame);
  const max = Math.max(1, ...Object.values(totals));
  const shown = contestants.slice(0, 10);
  const clock = new Date(minute).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ padding: '70px 110px', opacity: fadeIn }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={heading(64)}>The race</div>
        <div style={{ ...label, fontVariantNumeric: 'tabular-nums' }}>{clock} UTC</div>
      </div>
      {shown.map((c) => {
        const value = totals[c.id] ?? 0;
        const width = Math.max(0.02, value / max);
        return (
          <div
            key={c.id}
            style={{
              position: 'absolute',
              left: 110,
              right: 110,
              top: TOP + y(c.id),
              height: ROW - 14,
              display: 'flex',
              alignItems: 'center',
              gap: 20,
            }}
          >
            {c.imageUrl ? (
              <Img
                src={c.imageUrl}
                style={{
                  width: 62,
                  height: 62,
                  borderRadius: '50%',
                  background: SURFACE,
                  boxShadow: `0 0 0 3px ${c.accentFrom}`,
                }}
              />
            ) : (
              <div style={{ width: 62, height: 62 }} />
            )}
            <div style={{ flex: 1, position: 'relative', height: '100%' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${width * 100}%`,
                  borderRadius: 8,
                  background: `linear-gradient(90deg, ${c.accentFrom}, ${c.accentTo})`,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 20,
                  top: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  ...heading(34),
                  textShadow: '0 2px 8px rgb(0 0 0 / 0.5)',
                }}
              >
                {c.name}{' '}
                <span style={{ ...label, fontSize: 22, marginLeft: 14, color: INK, opacity: 0.8 }}>
                  {c.code}
                </span>
              </div>
            </div>
            <div
              style={{
                width: 220,
                textAlign: 'right',
                ...heading(44),
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {n.format(Math.round(value))}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function Standings({ contestants, totalVotes }: RecapData) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: '70px 160px' }}>
      <div style={{ ...heading(64), marginBottom: 30 }}>Final standings</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 60, rowGap: 14 }}>
        {contestants.map((c, i) => {
          const appear = interpolate(frame, [i * 4, i * 4 + 12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '14px 22px',
                borderRadius: 10,
                background: SURFACE,
                border: '1px solid #242a37',
                opacity: appear,
                transform: `translateX(${(1 - appear) * 30}px)`,
              }}
            >
              <div style={{ ...heading(40), width: 54, color: i === 0 ? INK : DIM }}>{i + 1}</div>
              <div
                style={{
                  width: 8,
                  alignSelf: 'stretch',
                  borderRadius: 4,
                  background: `linear-gradient(180deg, ${c.accentFrom}, ${c.accentTo})`,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={heading(34)}>{c.name}</div>
                <div style={{ ...label, fontSize: 20, marginTop: 6 }}>
                  {flag(c.countryCode)} {c.code} ·{' '}
                  {((c.total / Math.max(1, totalVotes)) * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ ...heading(40), fontVariantNumeric: 'tabular-nums' }}>
                {n.format(c.total)}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Winner({ contestants, totalVotes }: RecapData) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const winner = contestants[0];
  const runnerUp = contestants[1];
  if (!winner) return null;
  const pop = spring({ frame: frame - 10, fps, config: { damping: 14, stiffness: 90 } });
  const text = interpolate(frame, [35, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const glow = 40 + 20 * Math.sin(frame / 10);
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: 30,
        background: `radial-gradient(900px 700px at 50% 45%, ${winner.accentFrom}33, transparent 70%)`,
      }}
    >
      <div style={{ ...label, opacity: text }}>Winner</div>
      <div
        style={{
          width: 300,
          height: 300,
          borderRadius: '50%',
          transform: `scale(${pop})`,
          background: `linear-gradient(135deg, ${winner.accentFrom}, ${winner.accentTo})`,
          padding: 10,
          boxShadow: `0 0 ${glow}px ${winner.accentFrom}`,
        }}
      >
        {winner.imageUrl && (
          <Img
            src={winner.imageUrl}
            style={{ width: '100%', height: '100%', borderRadius: '50%', background: SURFACE }}
          />
        )}
      </div>
      <div style={{ ...heading(120), opacity: text }}>{winner.name}</div>
      <div style={{ ...heading(56), opacity: text, fontVariantNumeric: 'tabular-nums' }}>
        {n.format(winner.total)}{' '}
        <span style={{ ...label, fontSize: 30 }}>
          votes · {((winner.total / Math.max(1, totalVotes)) * 100).toFixed(1)}%
        </span>
      </div>
      {runnerUp && (
        <div style={{ ...label, fontSize: 24, opacity: text }}>
          {n.format(winner.total - runnerUp.total)} ahead of {runnerUp.name}
        </div>
      )}
    </AbsoluteFill>
  );
}
