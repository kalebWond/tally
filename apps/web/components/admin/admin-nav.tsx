import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/control', label: 'Generator' },
  { href: '/admin/contests', label: 'Contests' },
  { href: '/admin/contestants', label: 'Contestants' },
  { href: '/admin/dead-letters', label: 'Dead letters' },
] as const;

/** Top bar shared by the operator pages. */
export function AdminNav({ current }: { current: (typeof LINKS)[number]['href'] }) {
  return (
    <nav className="border-b bg-card/60">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-2">
        <span className="mr-4 font-heading text-lg font-bold tracking-wide uppercase">Tally</span>
        {LINKS.map((l) => (
          <Button
            key={l.href}
            variant={l.href === current ? 'secondary' : 'ghost'}
            size="sm"
            asChild
          >
            <Link href={l.href} aria-current={l.href === current ? 'page' : undefined}>
              {l.label}
            </Link>
          </Button>
        ))}
        <form action={logout} className="ml-auto">
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </nav>
  );
}
