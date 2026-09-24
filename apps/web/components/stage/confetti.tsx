'use client';

import { useEffect, useRef } from 'react';

const GOLDS = ['#f2c14e', '#ffdc86', '#d9a33a', '#fff4d6'];
const PIECES = 140;
/** Long enough for the slowest piece to fall past the bottom of the screen. */
const LAST_MS = 5200;

/**
 * One burst of gold confetti when voting closes (F32), in front of the board: a canvas drawn
 * for about five seconds, which then removes itself. Played only when the page sees the close,
 * never for reduced motion (components/stage/stage.tsx decides).
 */
export function Confetti({ colour, onDone }: { colour: string; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

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

    const colours = [...GOLDS, colour];
    const pieces = Array.from({ length: PIECES }, () => ({
      x: Math.random() * w,
      // Staggered above the top edge, so they arrive over the first second and a half.
      y: -20 - Math.random() * h * 0.6,
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
        const y = p.y + p.fall * t + 30 * t * t;
        if (y > h + 20) continue;
        const x = p.x + Math.sin(p.phase + t * 2) * p.drift;
        const angle = p.phase + p.spin * t;
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
  }, [colour]);

  // Nothing here for assistive technology: the board says who won.
  return <canvas ref={canvas} className="stage-confetti" data-testid="confetti" />;
}
