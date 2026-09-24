'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { SNAPPY } from '@/lib/motion';

const LINKS = [
  { href: '/control', label: 'Generator' },
  { href: '/admin/contests', label: 'Contests' },
  { href: '/admin/contestants', label: 'Contestants' },
  { href: '/admin/dead-letters', label: 'Dead letters' },
  { href: '/admin/analytics', label: 'Analytics' },
] as const;

/** The link a page belongs under: its own, or Contests for a contest's recap. */
function section(pathname: string): string | null {
  if (pathname.startsWith('/admin/recap/')) return '/admin/contests';
  return LINKS.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))?.href ?? null;
}

/**
 * Top bar shared by the operator pages, rendered once by their layout: a translucent bar the
 * page scrolls under (F31). The highlight slides to a link as soon as it's clicked, before the
 * next page has loaded, and follows the address if it changes any other way.
 */
export function AdminNav() {
  const current = section(usePathname());
  const [chosen, setChosen] = useState<string | null>(current);
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setChosen(current);
  }
  return (
    <nav className="op-nav">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-2">
        <span className="mr-4 font-heading text-lg font-bold tracking-wide uppercase">Tally</span>
        {LINKS.map((l) => (
          <Button key={l.href} variant="ghost" size="sm" className="relative isolate" asChild>
            <Link
              href={l.href}
              aria-current={l.href === current ? 'page' : undefined}
              data-chosen={l.href === chosen || undefined}
              onClick={(e) => {
                // A new tab or window leaves this page where it is.
                if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) setChosen(l.href);
              }}
            >
              {l.label}
              {l.href === chosen && (
                <motion.span
                  layoutId="nav-pill"
                  data-pill
                  className="absolute inset-0 -z-10 rounded-[inherit] bg-secondary"
                  transition={SNAPPY}
                />
              )}
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
