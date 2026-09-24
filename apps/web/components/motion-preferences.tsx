'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Honours the viewer's reduced-motion setting everywhere (F31): Motion then skips movement
 * (slides, layout glides, scaling) and keeps fades, so every change still shows, as a crossfade.
 */
export function MotionPreferences({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
