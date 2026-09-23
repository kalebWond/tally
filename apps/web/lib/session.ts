import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Shared-password admin sessions (SPEC §2: one password from the environment, no user accounts).
 *
 * The cookie holds `<expiresAt>.<signature>`, an HMAC over the expiry. There's nothing else to
 * store: the signature proves the holder once knew the password, and the expiry bounds how long
 * that counts. The signing key is derived from the password with scrypt, so changing
 * ADMIN_PASSWORD signs everyone out, and a stolen cookie is slow to brute-force for the password.
 */

/**
 * The shared admin password, or undefined when it isn't set (or is shorter than 8 characters),
 * in which case nobody can sign in. Read per call, from the runtime environment. No
 * `server-only` import here, because proxy.ts uses this module too.
 */
export const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD;
  return value && value.length >= 8 ? value : undefined;
};

export const SESSION_COOKIE = 'tally_admin';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const keys = new Map<string, Buffer>();
function signingKey(password: string) {
  let key = keys.get(password);
  if (!key) {
    key = scryptSync(password, 'tally-admin-session-v1', 32);
    keys.set(password, key);
  }
  return key;
}

const sign = (password: string, expiresAt: number) =>
  createHmac('sha256', signingKey(password)).update(`admin:${expiresAt}`).digest();

export function createSessionToken(password: string, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  return `${expiresAt}.${sign(password, expiresAt).toString('base64url')}`;
}

export function verifySessionToken(token: string | undefined, password: string, now = Date.now()) {
  const [, expiry, signature] = token?.match(/^(\d{13})\.([A-Za-z0-9_-]{43})$/) ?? [];
  if (!expiry || !signature) return false;
  const expiresAt = Number(expiry);
  if (expiresAt <= now) return false;
  return timingSafeEqual(Buffer.from(signature, 'base64url'), sign(password, expiresAt));
}

/** Constant-time password comparison: both sides are hashed first so lengths never differ. */
export function passwordMatches(attempt: string, password: string) {
  const digest = (s: string) => createHmac('sha256', 'tally-login').update(s).digest();
  return timingSafeEqual(digest(attempt), digest(password));
}

/**
 * Where to go after signing in. Only same-site paths: `//evil.com` or `https://…` would turn
 * the login page into an open redirect.
 */
export function safeNext(next: unknown) {
  if (
    typeof next !== 'string' ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.includes('\\')
  ) {
    return '/control';
  }
  return next;
}
