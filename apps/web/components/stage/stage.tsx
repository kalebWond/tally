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
 * frozen where it is and eased to the middle; starting again, it eases out from the middle to
 * the end of a swing and carries on from there, so the beam never jumps.
 */
function beam(outer: HTMLElement, cone: HTMLElement, mirrored: boolean) {
  const reach = mirrored ? -SWAY_DEG : SWAY_DEG;
  // At playback rate 1, one swing (half a sway) takes a second.
  const sway = cone.animate([rotate(-reach), rotate(reach)], {
    duration: 1000,
    iterations: Number.POSITIVE_INFINITY,
    direction: 'alternate',
    easing: 'ease-in-out',
  });
  // Held mid-swing, where the cone points straight along its aim, until the cue says sway.
  sway.pause();
  sway.currentTime = 500;
  let rate = 1;
  let easing: Animation | null = null;
  let swaying = false;

  return {
    tempo(periodS: number, now = false) {
      const target = 2 / periodS;
      rate = now ? target : rate + (target - rate) * FOLLOW;
      sway.updatePlaybackRate(rate);
      outer.dataset.period = (2 / rate).toFixed(1);
    },
    sway() {
      if (swaying) return;
      swaying = true;
      const from = angleOf(cone);
      easing?.cancel();
      const start = cone.animate([rotate(from), rotate(reach)], {
        duration: 500 / rate,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      easing = start;
      start.onfinish = () => {
        if (easing !== start) return;
        sway.currentTime = 1000;
        sway.play();
        start.cancel();
        easing = null;
      };
    },
    still(instant: boolean) {
      swaying = false;
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
  /** Codes of the panels the beams point at (left, right) in a spotlight or the finale. */
  aimAt: readonly [string, string] | null;
  /** True when the finale was already over when the page loaded: show it, don't play it. */
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

  // The cue: sway, or hold still and point. `aimAt` keeps its identity while its codes do.
  useEffect(() => {
    const [left, right] = beams.current;
    if (!left || !right) return;
    const instant = !posed.current || reduce;
    // Posed once the beams have somewhere to be: a finale waiting for the first snapshot to name
    // its winner is still to be posed, not played, when the winner arrives.
    if (cue === 'live' || cue === 'dark' || aimAt) posed.current = true;

    const point = () => {
      if (!aimAt || cue === 'live' || cue === 'dark') {
        left.aim(null, instant);
        right.aim(null, instant);
        return;
      }
      aimAt.forEach((code, i) => {
        const outer = outers.current[i];
        const target = panelCentre(code);
        const b = beams.current[i];
        if (outer && b) b.aim(target ? aimAngle(beamOrigin(outer), target) : null, instant);
      });
    };

    // Reduced motion: the beams hold a pose. They never sway, and a lead change doesn't move
    // them; the finale's pose (on the winner) is simply shown.
    if (reduce) {
      for (const b of [left, right]) b.still(true);
      if (cue === 'finale') point();
      else for (const b of [left, right]) b.aim(null, true);
      return;
    }

    if (cue === 'live') for (const b of [left, right]) b.sway();
    else for (const b of [left, right]) b.still(instant || cue === 'dark');
    point();

    // While pointing, follow the panel as the page scrolls or resizes.
    if (cue !== 'spotlight' && cue !== 'finale') return;
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

  // Confetti once, when this page sees voting close; never on a page that loaded closed.
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
