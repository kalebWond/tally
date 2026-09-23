import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdmin } from '@/lib/auth';
import { safeNext } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Tally' };

export default async function LoginPage(props: PageProps<'/login'>) {
  await connection();
  const next = safeNext((await props.searchParams).next);
  if (await isAdmin()) redirect(next);

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-2xl uppercase tracking-wide">
            Tally control
          </CardTitle>
          <CardDescription>
            The operator pages are protected by the shared admin password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
