import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  passwordMatches,
  SESSION_TTL_MS,
  safeNext,
  verifySessionToken,
} from './session';

const PASSWORD = 'correct horse battery';

describe('session tokens', () => {
  it('accepts a token it issued', () => {
    expect(verifySessionToken(createSessionToken(PASSWORD), PASSWORD)).toBe(true);
  });

  it('rejects a token once it expires', () => {
    const now = Date.now();
    const token = createSessionToken(PASSWORD, now);
    expect(verifySessionToken(token, PASSWORD, now + SESSION_TTL_MS - 1)).toBe(true);
    expect(verifySessionToken(token, PASSWORD, now + SESSION_TTL_MS)).toBe(false);
  });

  it('rejects a token whose expiry was pushed later: the signature covers it', () => {
    const [, signature] = createSessionToken(PASSWORD).split('.');
    const extended = `${Date.now() + 10 * SESSION_TTL_MS}.${signature}`;
    expect(verifySessionToken(extended, PASSWORD)).toBe(false);
  });

  it('signs everyone out when the password changes', () => {
    expect(verifySessionToken(createSessionToken(PASSWORD), 'a new password')).toBe(false);
  });

  it('rejects missing, malformed and forged tokens without throwing', () => {
    for (const token of [
      undefined,
      '',
      'x',
      '9999999999999.forged',
      `${Date.now() + 1000}.${'A'.repeat(43)}`,
    ]) {
      expect(verifySessionToken(token, PASSWORD)).toBe(false);
    }
  });
});

describe('passwordMatches', () => {
  it('matches only the exact password', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    for (const attempt of ['', 'correct horse', `${PASSWORD} `, PASSWORD.toUpperCase()]) {
      expect(passwordMatches(attempt, PASSWORD)).toBe(false);
    }
  });
});

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/control')).toBe('/control');
    expect(safeNext('/admin/contestants?x=1')).toBe('/admin/contestants?x=1');
  });

  it('refuses anything that could leave the site', () => {
    for (const next of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'control',
      undefined,
      42,
    ]) {
      expect(safeNext(next)).toBe('/control');
    }
  });
});
