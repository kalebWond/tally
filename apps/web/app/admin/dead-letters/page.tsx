import { DEAD_LETTER_REASONS, DeadLetterQuery } from '@tally/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { AdminNav } from '@/components/admin/admin-nav';
import { ContestPicker } from '@/components/admin/contest-picker';
import { DeadLetterTable, NewDeadLetters } from '@/components/admin/dead-letters';
import { Button } from '@/components/ui/button';
import { requireAdmin } from '@/lib/auth';
import { getContests, getCurrentContestId } from '@/lib/contests';
import { db } from '@/lib/db';
import { countDeadLetters, queryDeadLetters } from '@/lib/dead-letters';

export const metadata: Metadata = { title: 'Dead letters · Tally' };

const REASON_LABEL: Record<(typeof DEAD_LETTER_REASONS)[number], string> = {
  unknown_code: 'Unknown code',
  inactive_contestant: 'Inactive contestant',
  contest_closed: 'Contest closed',
  malformed: 'Malformed',
};

/** `contest=all` shows every contest (and malformed messages, which name none). */
const ALL = 'all';

export default async function DeadLettersPage(props: PageProps<'/admin/dead-letters'>) {
  await connection();
  await requireAdmin('/admin/dead-letters');

  const params = await props.searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? params[k] : undefined);
  const contests = await getContests();
  const contestParam = one('contest') ?? (await getCurrentContestId()) ?? ALL;
  const contestId = contestParam === ALL ? undefined : contestParam;
  // A bad cursor, reason or contest in a hand-edited URL falls back to the first page.
  const parsed = DeadLetterQuery.safeParse({
    contestId,
    reason: one('reason'),
    before: one('before'),
    after: one('after'),
  });
  const q = parsed.success
    ? parsed.data
    : (DeadLetterQuery.safeParse({ contestId }).data ?? DeadLetterQuery.parse({}));

  const [page, counts] = await Promise.all([
    queryDeadLetters(db(), q),
    countDeadLetters(db(), { contestId: q.contestId }),
  ]);

  const href = (change: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams({ contest: contestParam });
    if (q.reason) next.set('reason', q.reason);
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) next.delete(k);
      else next.set(k, String(v));
    }
    return `/admin/dead-letters?${next}`;
  };
  const newestHref = href({ before: undefined, after: undefined });
  const contestNames = Object.fromEntries(contests.map((c) => [c.id, c.name]));

  return (
    <>
      <AdminNav current="/admin/dead-letters" />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm tracking-widest text-muted-foreground uppercase">Tally · admin</p>
            <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">
              Dead letters
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Votes that were accepted but couldn't be counted, with the reason. Nothing is dropped
              silently.
            </p>
          </div>
          <ContestPicker
            contests={contests}
            value={contestParam}
            allValue={ALL}
            basePath="/admin/dead-letters"
          />
        </header>

        <nav aria-label="Reason" className="flex flex-wrap gap-2">
          <Chip
            href={href({ reason: undefined, before: undefined, after: undefined })}
            active={!q.reason}
            testId="reason-all"
          >
            All <Count n={counts.total} />
          </Chip>
          {DEAD_LETTER_REASONS.map((r) => (
            <Chip
              key={r}
              href={href({ reason: r, before: undefined, after: undefined })}
              active={q.reason === r}
              testId={`reason-${r}`}
            >
              {REASON_LABEL[r]} <Count n={counts.byReason[r]} testId={`count-${r}`} />
            </Chip>
          ))}
        </nav>

        <NewDeadLetters
          contestId={q.contestId}
          reason={q.reason}
          since={counts.latestId ?? 0}
          newestHref={newestHref}
        />

        <DeadLetterTable
          items={page.items}
          contestNames={contestNames}
          reasonLabels={REASON_LABEL}
        />

        <div className="flex items-center justify-between">
          <Button variant="outline" asChild={page.newer !== null} disabled={page.newer === null}>
            {page.newer !== null ? (
              <Link href={href({ after: page.newer, before: undefined })} data-testid="newer">
                ← Newer
              </Link>
            ) : (
              <span>← Newer</span>
            )}
          </Button>
          {(q.before !== undefined || q.after !== undefined) && (
            <Link
              href={newestHref}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to newest
            </Link>
          )}
          <Button variant="outline" asChild={page.older !== null} disabled={page.older === null}>
            {page.older !== null ? (
              <Link href={href({ before: page.older, after: undefined })} data-testid="older">
                Older →
              </Link>
            ) : (
              <span>Older →</span>
            )}
          </Button>
        </div>
      </main>
    </>
  );
}

function Chip(props: { href: string; active: boolean; testId: string; children: React.ReactNode }) {
  return (
    <Button variant={props.active ? 'secondary' : 'ghost'} size="sm" asChild>
      <Link
        href={props.href}
        data-testid={props.testId}
        aria-current={props.active ? 'true' : undefined}
      >
        {props.children}
      </Link>
    </Button>
  );
}

function Count({ n, testId }: { n: number; testId?: string }) {
  return (
    <span data-testid={testId} data-value={n} className="tabular-nums text-muted-foreground">
      {n.toLocaleString('en')}
    </span>
  );
}
