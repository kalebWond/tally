import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { safeTimeZone, TZ_COOKIE } from '@/lib/time';
import { TimeProvider } from './time';

/** Wraps operator pages so their times render in the viewer's zone from the first byte (F30). */
export async function OperatorTime({ children }: { children: ReactNode }) {
  const raw = (await cookies()).get(TZ_COOKIE)?.value ?? '';
  // Written unencoded by TimeProvider; decoded anyway in case a browser or an older version sent
  // it percent-encoded ("Africa%2FAddis_Ababa"), which would otherwise fall back to UTC.
  let zone = raw;
  try {
    zone = decodeURIComponent(raw);
  } catch {}
  const timeZone = safeTimeZone(zone);
  return (
    <TimeProvider timeZone={timeZone} now={Date.now()}>
      {children}
    </TimeProvider>
  );
}
