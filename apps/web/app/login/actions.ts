'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  adminPassword,
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  safeNext,
} from '@/lib/session';

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const password = adminPassword();
  if (!password) return { error: 'Sign-in is disabled: ADMIN_PASSWORD is not set on the server.' };

  if (!passwordMatches(String(form.get('password') ?? ''), password)) {
    await new Promise((r) => setTimeout(r, 500)); // slows guessing; no lockout state to keep
    return { error: 'Wrong password.' };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: (await headers()).get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect(safeNext(form.get('next')));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
