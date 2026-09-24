import { describe, expect, it } from 'vitest';
import { clockTime, formatTime, fullTime, safeTimeZone, utcTime } from './time';

const AT = '2026-09-24T14:34:05.123Z';
const t = Date.parse(AT);

describe('formatTime', () => {
  it('is relative within a day, rounding down', () => {
    expect(formatTime(AT, 'UTC', t + 59_999)).toBe('just now');
    expect(formatTime(AT, 'UTC', t - 5_000)).toBe('just now'); // clock skew: a stamp from the future
    expect(formatTime(AT, 'UTC', t + 60_000)).toBe('1 min ago');
    expect(formatTime(AT, 'UTC', t + 59 * 60_000 + 59_000)).toBe('59 min ago');
    expect(formatTime(AT, 'UTC', t + 3_600_000)).toBe('1 h ago');
    expect(formatTime(AT, 'UTC', t + 86_399_000)).toBe('23 h ago');
  });

  it('is a date and time in the viewer’s zone after a day', () => {
    const later = t + 86_400_000;
    expect(formatTime(AT, 'UTC', later)).toBe('24 Sept 2026, 14:34');
    expect(formatTime(AT, 'Africa/Addis_Ababa', later)).toBe('24 Sept 2026, 17:34');
    expect(formatTime(AT, 'Asia/Kolkata', later)).toBe('24 Sept 2026, 20:04');
  });
});

describe('tooltip and clock formats', () => {
  it('full local time names the zone; UTC is spelled out', () => {
    expect(fullTime(AT, 'Africa/Addis_Ababa')).toMatch(
      /^Thu,? 24 Sept 2026,? 17:34:05 (GMT\+3|EAT)$/,
    );
    expect(utcTime(AT)).toBe('2026-09-24 14:34:05 UTC');
  });

  it('clock time keeps milliseconds, in the zone', () => {
    expect(clockTime(AT, 'Asia/Kolkata')).toBe('20:04:05.123');
  });
});

describe('safeTimeZone', () => {
  it('keeps a real zone and falls back to UTC for anything else', () => {
    expect(safeTimeZone('Africa/Addis_Ababa')).toBe('Africa/Addis_Ababa');
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeTimeZone('')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });
});
