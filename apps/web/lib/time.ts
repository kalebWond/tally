// Operator-facing times (F30): the viewer's own zone, "x min ago" within a day, UTC on hover.
// Pure and locale-fixed, so the server's render and the browser's first render match exactly.

/**
 * The cookie that carries the browser's time zone to the server. Kept here, not in the client
 * component that writes it: a server component importing a value from a 'use client' module gets
 * a client reference, not the string.
 */
export const TZ_COOKIE = 'tz';

const LOCALE = 'en-GB';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An IANA zone the runtime knows, or UTC (a bad or missing cookie never breaks a page). */
export function safeTimeZone(zone: string | undefined | null) {
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/** "just now", "12 min ago", "3 h ago" within a day; after that "24 Sep 2026, 17:34". */
export function formatTime(iso: string, timeZone: string, now: number) {
  const at = Date.parse(iso);
  const ago = now - at;
  if (ago < MINUTE) return 'just now'; // also a slightly future stamp (clock skew)
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** "Thu 24 Sep 2026, 17:34:05 GMT+3": the full local time, for tooltips. */
export function fullTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(Date.parse(iso));
}

/** "2026-09-24 14:34:05 UTC". */
export const utcTime = (iso: string) =>
  `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;

/** "17:34:05.123" in the zone: for rows seconds apart, like dead letters. */
export function clockTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).format(Date.parse(iso));
}
