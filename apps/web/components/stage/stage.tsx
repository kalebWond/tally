'use client';

import { useReducedMotion } from 'motion/react';
import { memo, type RefObject, useEffect, useRef, useState } from 'react';
import { aimAngle, type Cue, swayPeriod } from '@/lib/lighting';
import { type TotalSample, voteRate } from '@/lib/liveliness';
import { Confetti } from './confetti';
import { BackScene, Crowd, Wall } from './scene';

/** The stage's colours before anyone leads: a neutral show blue. */
export const HOUSE_COLOURS = { from: '#3347d6', to: '#8b3dff' } as const;

interface Colours {
  from: string;
  to: string;
}

/**
 * Two walls, one shown: a change of colours goes to the hidden one, which then fades in over
 * the other. Opacity only, so the crossfade never repaints the drawing.
 */
function useCrossfade(colours: Colours) {
  const [walls, setWalls] = useState({ a: colours, b: colours, front: 'a' as 'a' | 'b' });
  const shown = walls[walls.front];
  if (shown.from !== colours.from || shown.to !== colours.to) {
    const back = walls.front === 'a' ? 'b' : 'a';
    setWalls({ ...walls, [back]: colours, front: back });
  }
  return walls;
}

/** How far a beam sways either side of its resting angle. */
const SWAY_DEG = 6;
/** How often the sway's tempo is brought up to date with the vote rate. */
const RETUNE_MS = 1000;
/** How much of the gap to the new tempo each retune closes. */
const FOLLOW = 0.35;
/** A beam swinging onto a target, or settling still: a heavy lamp, so a little slower than UI. */
const SWING_MS = 900;
/**
 * The finale's wander (F39): wide, slow sweeps, each beam on its own period, so they drift in
 * and out of step instead of pointing anywhere.
 */
const WANDER_DEG = 20;
const WANDER_S = [7.5, 10] as const;

const angleOf = (el: Element) => {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
};
const rotate = (deg: number) => ({ transform: `rotate(${deg}deg)` });
const springEasing = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim() || 'ease-out';

/**
 * One searchlight. The outer element points it (a CSS transition, so a new aim mid-swing turns
 * from wherever it is); the inner cone sways about that aim (a Web Animation, whose playback rate
 * sets the tempo and keeps its place). Both run on the compositor. Going still, the sway is
 * frozen where it is and eased to the middle; starting again, it eases out from where it is to
 * the end of a swing and carries on from there, so the beam never jumps. The finale's wander is
 * the same animation with a wider reach and a fixed, slower tempo.
 */
function beam(outer: HTMLElement, cone: HTMLElement, mirrored: boolean) {
  const side = mirrored ? -1 : 1;
  const swing = (deg: number) => [rotate(-deg * side), rotate(deg * side)];
  // At playback rate 1, one swing (half a sway) takes a second.
  const sway = cone.animate(swing(SWAY_DEG), {
    duration: 1000,
    iterations: Number.POSITIVE_INFINITY,
    direction: 'alternate',
    easing: 'ease-in-out',
  });
  // Held mid-swing, where the cone points straight along its aim, until the cue says sway.
  sway.pause();
  sway.currentTime = 500;
  /** The live tempo, following the vote rate even while the beam wanders or holds still. */
  let rate = 1;
  let mode: 'still' | 'sway' | 'wander' = 'still';
  let easing: Animation | null = null;

  // Eases from wherever the cone points to the end of a swing, then lets the loop carry on.
  const start = (reach: number, playRate: number) => {
    (sway.effect as KeyframeEffect).setKeyframes(swing(reach));
    sway.updatePlaybackRate(playRate);
    const from = angleOf(cone);
    easing?.cancel();
    const ease = cone.animate([rotate(from), rotate(reach * side)], {
      duration: 500 / playRate,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    easing = ease;
    ease.onfinish = () => {
      if (easing !== ease) return;
      sway.currentTime = 1000;
      sway.play();
      ease.cancel();
      easing = null;
    };
  };

  return {
    tempo(periodS: number, now = false) {
      const target = 2 / periodS;
      rate = now ? target : rate + (target - rate) * FOLLOW;
      if (mode === 'wander') return;
      sway.updatePlaybackRate(rate);
      outer.dataset.period = (2 / rate).toFixed(1);
    },
    sway() {
      if (mode === 'sway') return;
      mode = 'sway';
      start(SWAY_DEG, rate);
    },
    wander(periodS: number) {
      if (mode === 'wander') return;
      mode = 'wander';
      outer.dataset.period = periodS.toFixed(1);
      start(WANDER_DEG, 2 / periodS);
    },
    still(instant: boolean) {
      mode = 'still';
      const from = angleOf(cone);
      sway.pause();
      easing?.cancel();
      easing = cone.animate([rotate(from), rotate(0)], {
        duration: instant ? 0 : SWING_MS,
        easing: springEasing(),
        fill: 'forwards',
      });
    },
    /** Points the beam at an angle, or back to its resting angle (null). */
    aim(angle: number | null, instant: boolean) {
      if (instant) outer.style.transition = 'none';
      outer.style.transform = angle === null ? '' : `rotate(${angle.toFixed(2)}deg)`;
      outer.dataset.aim = angle === null ? '' : angle.toFixed(1);
      if (instant) {
        outer.getBoundingClientRect();
        outer.style.transition = '';
      }
    },
    stop() {
      sway.cancel();
      easing?.cancel();
    },
  };
}

/** Where a row's panel sits in the viewport once any glide it is in has finished. */
function panelCentre(code: string) {
  const row = document.querySelector<HTMLElement>(`.row[data-code="${CSS.escape(code)}"]`);
  const parent = row?.offsetParent;
  if (!row || !parent) return null;
  const box = parent.getBoundingClientRect();
  return {
    x: box.left + row.offsetLeft + row.offsetWidth / 2,
    y: box.top + row.offsetTop + row.offsetHeight / 2,
  };
}

/** The point a beam turns about: the bottom middle of its outer element, in the viewport. */
function beamOrigin(outer: HTMLElement) {
  return { x: outer.offsetLeft + outer.offsetWidth / 2, y: outer.offsetTop + outer.offsetHeight };
}

interface Props {
  colours: Colours;
  cue: Cue;
  /** The code of the panel both beams cross on during a lead-change spotlight. */
  aimAt: string | null;
  /** True when the contest was closed and counted when the page loaded: show it, don't play it. */
  settled: boolean;
  samples: RefObject<TotalSample[]>;
}

/**
 * The stage behind the results board (F32): the house and rig, the LED wall in the leader's
 * colours, two searchlights rising from the bottom corners, and the audience in front of them.
 * The lights follow the contest (lib/lighting.ts). Decorative, so hidden from assistive
 * technology; the board carries all the information.
 */
export const Stage = memo(function Stage({ colours, cue, aimAt, settled, samples }: Props) {
  const walls = useCrossfade(colours);
  const reduce = useReducedMotion() ?? false;
  // The two searchlights' elements, left then right.
  const outers = useRef<(HTMLSpanElement | null)[]>([]);
  const cones = useRef<(HTMLSpanElement | null)[]>([]);
  const beams = useRef<ReturnType<typeof beam>[]>([]);
  // The first aim after load is a pose, not a movement.
  const posed = useRef(false);
  const [confetti, setConfetti] = useState(false);
  const [lastCue, setLastCue] = useState(cue);

  // The two lamps, and the sway's tempo following the vote rate.
  useEffect(() => {
    const made = [0, 1].map((i) => {
      const outer = outers.current[i];
      const cone = cones.current[i];
      return outer && cone ? beam(outer, cone, i === 1) : null;
    });
    if (made.some((b) => b === null)) return;
    beams.current = made as ReturnType<typeof beam>[];
    const retune = (now = false) => {
      const period = swayPeriod(voteRate(samples.current, performance.now()));
      for (const b of beams.current) b.tempo(period, now);
    };
    retune(true);
    const timer = setInterval(retune, RETUNE_MS);
    return () => {
      clearInterval(timer);
      for (const b of beams.current) b.stop();
      beams.current = [];
      posed.current = false;
    };
  }, [samples]);

  // The cue: sway, wander, or hold still and point.
  useEffect(() => {
    const [left, right] = beams.current;
    if (!left || !right) return;
    const instant = !posed.current || reduce;
    posed.current = true;
    const lamps = [left, right];

    const point = () => {
      lamps.forEach((b, i) => {
        const outer = outers.current[i];
        const target = cue === 'spotlight' && aimAt ? panelCentre(aimAt) : null;
        b.aim(outer && target ? aimAngle(beamOrigin(outer), target) : null, instant);
      });
    };

    // Reduced motion: the beams hold their resting pose. They never sway or wander, and a lead
    // change doesn't move them.
    if (reduce) {
      for (const b of lamps) {
        b.still(true);
        b.aim(null, true);
      }
      return;
    }

    if (cue === 'live') for (const b of lamps) b.sway();
    else if (cue === 'finale') {
      left.wander(WANDER_S[0]);
      right.wander(WANDER_S[1]);
    } else for (const b of lamps) b.still(instant || cue === 'dark');
    point();

    // While pointing, follow the panel as the page scrolls or resizes.
    if (cue !== 'spotlight') return;
    let frame = 0;
    const follow = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          point();
        });
    };
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
    };
  }, [cue, aimAt, reduce]);

  // Confetti once, when this page sees the last vote counted after the close (F39); never on a
  // page that loaded with the contest already closed and counted.
  if (cue !== lastCue) {
    setLastCue(cue);
    if (cue === 'finale' && !settled && !reduce) setConfetti(true);
  }

  return (
    <>
      <div className="stage" aria-hidden="true" data-cue={cue}>
        <BackScene />
        <Wall id="stage-wall-a" {...walls.a} shown={walls.front === 'a'} />
        <Wall id="stage-wall-b" {...walls.b} shown={walls.front === 'b'} />
        <div className="stage-dim" />
        {(['left', 'right'] as const).map((side, i) => (
          <span
            key={side}
            ref={(el) => {
              outers.current[i] = el;
            }}
            className="stage-beam"
            data-side={side}
          >
            <span
              ref={(el) => {
                cones.current[i] = el;
              }}
              className="stage-beam-cone"
            />
          </span>
        ))}
        <span className="stage-lamp" data-side="left" />
        <span className="stage-lamp" data-side="right" />
        <Crowd />
      </div>
      {/* In front of the board, as confetti falls in front of everything on a stage. */}
      {confetti && <Confetti colour={colours.from} onDone={() => setConfetti(false)} />}
    </>
  );
});
