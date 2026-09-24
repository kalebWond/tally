import { type CSSProperties, memo } from 'react';

/*
 * The stage behind the results board (F32), drawn rather than photographed: no rights to
 * clear and nobody real in it. Everything is out of focus, as if the camera were focused on
 * the board, and the softness is drawn in (SVG blur, rasterised once), so nothing here costs
 * anything per frame. All three drawings share one 1920×1080 frame and are scaled to cover
 * the screen, so their parts line up at any size.
 */

const FRAME = '0 0 1920 1080';

/** A small seeded generator, so the lamps and the crowd are the same on every render. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Lamp {
  x: number;
  y: number;
  r: number;
  warm: boolean;
  o: number;
}

/** Two lighting trusses across the top, and a tower of lamps on each side. */
const LAMPS: Lamp[] = (() => {
  const rnd = seeded(7);
  const lamps: Lamp[] = [];
  // The far truss: small, dim, closely spaced.
  for (let x = 40; x < 1900; x += 58) {
    lamps.push({
      x: x + rnd() * 8,
      y: 52 + rnd() * 4,
      r: 5 + rnd() * 3,
      warm: rnd() > 0.3,
      o: 0.35 + rnd() * 0.35,
    });
  }
  // The near truss: bigger and brighter, farther apart.
  for (let x = 70; x < 1880; x += 96) {
    lamps.push({
      x: x + rnd() * 10,
      y: 122 + rnd() * 6,
      r: 8 + rnd() * 4,
      warm: rnd() > 0.25,
      o: 0.45 + rnd() * 0.4,
    });
  }
  // The towers.
  for (const tower of [118, 1802]) {
    for (let y = 190; y < 700; y += 58) {
      for (const dx of [-11, 11]) {
        lamps.push({
          x: tower + dx,
          y: y + rnd() * 4,
          r: 6 + rnd() * 3,
          warm: rnd() > 0.4,
          o: 0.3 + rnd() * 0.45,
        });
      }
    }
  }
  return lamps;
})();

/** Big, very soft discs: lights far out of focus, for depth. */
const HAZE = (() => {
  const rnd = seeded(23);
  return Array.from({ length: 9 }, () => ({
    x: rnd() * 1920,
    y: 60 + rnd() * 560,
    r: 50 + rnd() * 90,
    warm: rnd() > 0.5,
    o: 0.05 + rnd() * 0.07,
  }));
})();

/** The house and the rig: dark room, trusses, towers and the floor. Never changes. */
export const BackScene = memo(function BackScene() {
  return (
    <svg
      className="stage-layer"
      viewBox={FRAME}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="stage-house" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d1224" />
          <stop offset="0.55" stopColor="#06070d" />
          <stop offset="1" stopColor="#030306" />
        </linearGradient>
        <linearGradient id="stage-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0d16" />
          <stop offset="0.35" stopColor="#05060b" />
          <stop offset="1" stopColor="#020204" />
        </linearGradient>
        <radialGradient id="stage-lamp-warm">
          <stop offset="0" stopColor="#fff6e6" />
          <stop offset="0.6" stopColor="#ffd9a3" />
          <stop offset="1" stopColor="#ffb566" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="stage-lamp-cool">
          <stop offset="0" stopColor="#f2f6ff" />
          <stop offset="0.6" stopColor="#c6d6ff" />
          <stop offset="1" stopColor="#8fa8ff" stopOpacity="0" />
        </radialGradient>
        <filter id="stage-bokeh" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <filter id="stage-far" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id="stage-metal">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <rect width="1920" height="1080" fill="url(#stage-house)" />

      {/* Truss bars and towers, just catching the light. */}
      <g filter="url(#stage-metal)" fill="#1b2135" opacity="0.8">
        <rect x="0" y="46" width="1920" height="12" />
        <rect x="0" y="114" width="1920" height="16" />
        <rect x="100" y="150" width="36" height="570" />
        <rect x="1784" y="150" width="36" height="570" />
      </g>

      <g filter="url(#stage-far)">
        {HAZE.map((h) => (
          <circle
            key={`${h.x}:${h.y}`}
            cx={h.x}
            cy={h.y}
            r={h.r}
            fill={h.warm ? '#ffcf8a' : '#9fb4ff'}
            opacity={h.o}
          />
        ))}
      </g>

      <g filter="url(#stage-bokeh)">
        {LAMPS.map((l) => (
          <circle
            key={`${l.x}:${l.y}`}
            cx={l.x}
            cy={l.y}
            r={l.r}
            fill={l.warm ? 'url(#stage-lamp-warm)' : 'url(#stage-lamp-cool)'}
            opacity={l.o}
          />
        ))}
      </g>

      {/* The stage floor, with its lip catching the light. */}
      <rect x="0" y="700" width="1920" height="380" fill="url(#stage-floor)" />
      <rect
        x="0"
        y="698"
        width="1920"
        height="3"
        fill="#2c3552"
        opacity="0.7"
        filter="url(#stage-bokeh)"
      />
    </svg>
  );
});

/** Where the LED wall's panels meet, and where the footlights sit, across the frame. */
const SEAMS = Array.from({ length: 19 }, (_, i) => 390 + (i + 1) * 57);
const FOOTLIGHTS = Array.from({ length: 24 }, (_, i) => 60 + i * 78);

/**
 * The LED wall, the side screens, the footlights and their reflection in the floor, lit in
 * two colours (the leader's). The board fades between two of these when the colours change.
 */
export const Wall = memo(function Wall(props: {
  id: string;
  from: string;
  to: string;
  shown: boolean;
}) {
  const { id, from, to, shown } = props;
  const g = `${id}-g`;
  return (
    <svg
      className="stage-layer stage-wall"
      aria-hidden="true"
      data-shown={shown || undefined}
      viewBox={FRAME}
      preserveAspectRatio="xMidYMid slice"
      style={{ '--wall-from': from, '--wall-to': to } as CSSProperties}
    >
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--wall-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--wall-to)' }} />
        </linearGradient>
        <linearGradient id={`${id}-down`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--wall-to)' }} stopOpacity="0.9" />
          <stop offset="1" style={{ stopColor: 'var(--wall-to)' }} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-hot`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`${id}-spill`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="70" />
        </filter>
        <filter id={`${id}-refl`} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>

      {/* The light the wall throws into the room. */}
      <rect
        x="300"
        y="110"
        width="1320"
        height="600"
        fill={`url(#${g})`}
        opacity="0.32"
        filter={`url(#${id}-spill)`}
      />

      <g filter={`url(#${id}-soft)`}>
        {/* The main wall, in LED panels. */}
        <rect x="390" y="165" width="1140" height="500" rx="4" fill={`url(#${g})`} opacity="0.6" />
        <g fill="#04050a" opacity="0.4">
          {SEAMS.map((x) => (
            <rect key={x} x={x} y="165" width="4" height="500" />
          ))}
          <rect x="390" y="330" width="1140" height="4" />
          <rect x="390" y="497" width="1140" height="4" />
        </g>
        <ellipse cx="960" cy="400" rx="420" ry="190" fill={`url(#${id}-hot)`} />
        {/* Side screens, seen past the board. */}
        <rect x="236" y="190" width="84" height="460" rx="3" fill={`url(#${g})`} opacity="0.55" />
        <rect x="1600" y="190" width="84" height="460" rx="3" fill={`url(#${g})`} opacity="0.55" />
      </g>

      {/* Footlights along the lip of the stage. */}
      <g filter={`url(#${id}-soft)`} style={{ fill: 'var(--wall-from)' }} opacity="0.8">
        {FOOTLIGHTS.map((x) => (
          <circle key={x} cx={x} cy="706" r="5" />
        ))}
      </g>

      {/* The wall, reflected in the glossy floor. */}
      <rect
        x="390"
        y="712"
        width="1140"
        height="250"
        fill={`url(#${id}-down)`}
        opacity="0.22"
        filter={`url(#${id}-refl)`}
      />
    </svg>
  );
});

interface Person {
  x: number;
  y: number;
  scale: number;
  phone: boolean;
}

/**
 * Two rows of audience in silhouette, closest to the camera, so the most out of focus. Packed
 * close, so the shoulders merge into one dark mass and only the heads read, the way a crowd
 * reads from the stage.
 */
const CROWD: { back: Person[]; front: Person[] } = (() => {
  const rnd = seeded(41);
  const row = (y: number, step: number, scale: number, phones: number) => {
    const people: Person[] = [];
    for (let x = -40; x < 1980; x += step * (0.75 + rnd() * 0.5)) {
      people.push({
        x,
        y: y + rnd() * 16,
        scale: scale * (0.88 + rnd() * 0.24),
        phone: rnd() < phones,
      });
    }
    return people;
  };
  return { back: row(990, 64, 0.85, 0.05), front: row(1046, 96, 1.3, 0.03) };
})();

/** Head and shoulders, the shoulders running out of frame; a raised phone now and then. */
function Silhouette({ p }: { p: Person }) {
  const { x, y, scale: s } = p;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {p.phone && (
        <>
          <path d="M 26 50 L 44 -52" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
          <rect x="36" y="-80" width="15" height="25" rx="2" className="stage-phone" />
        </>
      )}
      <ellipse cx="0" cy="0" rx="21" ry="26" />
      <path d="M -66 170 C -66 70 -46 38 0 36 C 46 38 66 70 66 170 Z" />
    </g>
  );
}

/** The audience, in front of the searchlights: the beams rise from behind them. */
export const Crowd = memo(function Crowd() {
  return (
    <svg
      className="stage-layer stage-crowd"
      viewBox={FRAME}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <filter id="stage-crowd-back" x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="stage-crowd-front" x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      {/* Rim light: the same shapes a little higher, lit by the stage, behind each row. */}
      <g filter="url(#stage-crowd-back)">
        <g transform="translate(0 -3)" color="#1b2236" fill="#1b2236">
          {CROWD.back.map((p) => (
            <Silhouette key={p.x} p={p} />
          ))}
        </g>
        <g color="#080a12" fill="#080a12">
          {CROWD.back.map((p) => (
            <Silhouette key={p.x} p={p} />
          ))}
        </g>
      </g>
      <g filter="url(#stage-crowd-front)">
        <g transform="translate(0 -4)" color="#121829" fill="#121829">
          {CROWD.front.map((p) => (
            <Silhouette key={p.x} p={p} />
          ))}
        </g>
        <g color="#020305" fill="#020305">
          {CROWD.front.map((p) => (
            <Silhouette key={p.x} p={p} />
          ))}
        </g>
      </g>
    </svg>
  );
});
