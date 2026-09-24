'use client';

import { motion, useIsPresent } from 'motion/react';
import type { ComponentProps } from 'react';
import { TableRow } from '@/components/ui/table';

const MotionTableRow = motion.create(TableRow);

/**
 * Table rows that can animate in and out (F31), inside an AnimatePresence. While one is leaving
 * it is inert and hidden from assistive tech: as far as the page is concerned it's already gone,
 * so nothing can click it or read it during its fade.
 */
export function PresenceRow(props: ComponentProps<typeof MotionTableRow>) {
  const present = useIsPresent();
  return (
    <MotionTableRow
      {...props}
      data-exiting={present ? undefined : true}
      aria-hidden={present ? undefined : true}
      inert={!present}
    />
  );
}

/** The same for a plain `<tr>` (the sample contestants' review table). */
export function PresenceTr(props: ComponentProps<typeof motion.tr>) {
  const present = useIsPresent();
  return (
    <motion.tr
      {...props}
      data-exiting={present ? undefined : true}
      aria-hidden={present ? undefined : true}
      inert={!present}
    />
  );
}
