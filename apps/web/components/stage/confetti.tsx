'use client';

import { useEffect, useRef } from 'react';

const GOLDS = ['#f2c14e', '#ffdc86', '#d9a33a', '#fff4d6'];
/** Pieces arrive over the first few seconds, so the fall lasts about nine (F39). */
const PIECES = 260;
const ARRIVE_S = 5;
/** The last piece to enter, at the slowest fall, is past a 1080 px screen by then. */
const LAST_MS = 9600;

/**
 * One fall of gold confetti when the result is in (F32, F39), in front of the board: a canvas
 * drawn for about nine seconds, which then removes itself. Played only when the page sees the
 * last vote counted after the close, never for reduced motion (components/stage/stage.tsx
 * decides). It plays once: the winner's colour is taken when it starts, and a later colour
 * change doesn't start it again.
 */
export function Confetti({ colour, onDone }: { colour: string; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const accent = useRef(colour);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.width = w * dpr;
    el.height = h * dpr;
    g.scale(dpr, dpr);

    const colours = [...GOLDS, accent.current];
    const pieces = Array.from({ length: PIECES }, () => ({
      x: Math.random() * w,
      // Staggered: each enters at the top edge at its own moment over the first ARRIVE_S seconds.
      delay: Math.random() * ARRIVE_S,
      y: -20,
      fall: 110 + Math.random() * 120,
      drift: 20 + Math.random() * 40,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 8,
      size: 5 + Math.random() * 6,
      colour: colours[Math.floor(Math.random() * colours.length)] ?? '#f2c14e',
    }));

    const start = performance.now();
    let frame = requestAnimationFrame(function draw(now) {
      const t = (now - start) / 1000;
      g.clearRect(0, 0, w, h);
      for (const p of pieces) {
        const age = t - p.delay;
        if (age < 0) continue;
        const y = p.y + p.fall * age + 30 * age * age;
        if (y > h + 20) continue;
        const x = p.x + Math.sin(p.phase + age * 2) * p.drift;
        const angle = p.phase + p.spin * age;
        g.save();
        g.translate(x, y);
        g.rotate(angle);
        // A flat piece tumbling: its apparent width follows the spin.
        g.scale(Math.cos(angle * 1.7), 1);
        g.fillStyle = p.colour;
        g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        g.restore();
      }
      if (now - start < LAST_MS) frame = requestAnimationFrame(draw);
      else done.current();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Nothing here for assistive technology: the board says who won.
  return <canvas ref={canvas} className="stage-confetti" data-testid="confetti" />;
}
