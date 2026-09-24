'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { clockTime, formatTime, fullTime, TZ_COOKIE, utcTime } from '@/lib/time';

const TimeContext = createContext({ timeZone: 'UTC', now: 0 });

/** The viewer's zone, as the server rendered with it. */
export const useTimeZone = () => useContext(TimeContext).timeZone;

/**
 * Operator pages' times (F30). The server renders in the zone from the `tz` cookie, with its own
 * clock as `now`, so the browser's first render produces the same text (no hydration mismatch).
 * If the browser's zone differs from the cookie (first visit, or travel), the cookie is updated
 * and the page re-rendered once.
 */
export function TimeProvider(props: { timeZone: string; now: number; children: ReactNode }) {
  const { timeZone, now, children } = props;
  const router = useRouter();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === timeZone) return;
    const current = document.cookie.match(/(?:^|; )tz=([^;]*)/)?.[1];
    // Already sent and the server still says otherwise (a zone it doesn't know): don't loop.
    if (current && decodeURIComponent(current) === zone) return;
    // IANA names ("Africa/Addis_Ababa", "Etc/GMT+3") are cookie-safe as they are: no encoding,
    // so the server reads exactly the name.
    // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie; the Cookie Store API isn't in every browser.
    document.cookie = `${TZ_COOKIE}=${zone}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [timeZone, router]);
  return <TimeContext.Provider value={{ timeZone, now }}>{children}</TimeContext.Provider>;
}

/** "12 min ago" within a day, else a local date and time; full local time and UTC on hover. */
export function Time({ iso }: { iso: string }) {
  const { timeZone, now: renderedAt } = useContext(TimeContext);
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={iso} title={`${fullTime(iso, timeZone)} · ${utcTime(iso)}`}>
      {formatTime(iso, timeZone, now)}
    </time>
  );
}

/** Local clock time with milliseconds, for rows seconds apart; the full time and UTC on hover. */
export function ClockTime({ iso }: { iso: string }) {
  const timeZone = useTimeZone();
  return (
    <time dateTime={iso} title={`${fullTime(iso, timeZone)} · ${utcTime(iso)}`}>
      {clockTime(iso, timeZone)}
    </time>
  );
}
