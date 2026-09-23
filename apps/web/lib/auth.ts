import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { adminPassword, SESSION_COOKIE, verifySessionToken } from './session';

/**
 * The authoritative admin check: every protected page, route handler and server action calls
 * this. proxy.ts runs the same check up front, but only as a first filter.
 */
export const isAdmin = cache(async () => {
  const password = adminPassword();
  if (!password) return false;
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, password);
});

/** For protected pages: sends a signed-out visitor to the login page, then back to `path`. */
export async function requireAdmin(path: string) {
  if (!(await isAdmin())) redirect(`/login?next=${encodeURIComponent(path)}`);
}
