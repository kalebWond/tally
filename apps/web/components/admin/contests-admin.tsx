'use client';

import { type Contest, ErrorResponse } from '@tally/contracts';
import { Clapperboard, ExternalLink, Plus, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Time, useTimeZone } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fullTime } from '@/lib/time';

type Action = { contest: Contest; to: 'open' | 'closed' };

const ACTION: Record<Contest['status'], { to: 'open' | 'closed'; label: string } | null> = {
  draft: { to: 'open', label: 'Open voting' },
  open: { to: 'closed', label: 'Close voting' },
  closed: { to: 'open', label: 'Reopen' },
};

const EXPLAIN: Record<Contest['status'], string> = {
  draft: 'Votes start counting from this moment. Open results pages switch to Live.',
  open: 'Votes ingest accepts from this moment on are dead-lettered as “contest closed”. Votes already accepted still count, even if they are still in the queue. Open results pages show Final.',
  closed:
    'Starts a new voting window from this moment. Votes sent while the contest was closed stay in dead letters.',
};

const STATUS_TONE: Record<Contest['status'], string> = {
  open: 'bg-live text-white',
  closed: 'bg-foreground text-background',
  draft: 'bg-muted text-muted-foreground',
};

const FILTERS = ['all', 'open', 'draft', 'closed'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  open: 'Open',
  draft: 'Draft',
  closed: 'Closed',
};

export function ContestsAdmin({
  contests,
  contestantCounts,
  initialFilter,
}: {
  /** Newest first (F30): a row's place never depends on its status. */
  contests: Contest[];
  /** Active contestants per contest id. */
  contestantCounts: Record<string, number>;
  initialFilter: Filter;
}) {
  const router = useRouter();
  const timeZone = useTimeZone();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  // The rows the filter matched when it was chosen stay listed even if their status changes, so
  // closing a contest while viewing "Open" doesn't make it vanish under the pointer.
  const [kept, setKept] = useState(
    () => new Set(contests.filter((c) => c.status === initialFilter).map((c) => c.id)),
  );
  const shown = contests.filter((c) => filter === 'all' || c.status === filter || kept.has(c.id));
  const count = (f: Filter) =>
    f === 'all' ? contests.length : contests.filter((c) => c.status === f).length;
  function chooseFilter(next: Filter) {
    setFilter(next);
    setKept(new Set(contests.filter((c) => c.status === next).map((c) => c.id)));
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('status');
    else url.searchParams.set('status', next);
    window.history.replaceState(null, '', url);
  }
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Contest | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function apply({ contest, to }: Action) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/contests/${contest.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: to }),
      });
      const json: unknown = await res.json();
      if (res.ok) {
        const { contest: updated, liveUpdated } = json as {
          contest: Contest;
          liveUpdated: boolean;
        };
        const stamp =
          to === 'closed'
            ? `Cut-off: ${updated.closesAt ? fullTime(updated.closesAt, timeZone) : '—'}.`
            : `Open since ${updated.opensAt ? fullTime(updated.opensAt, timeZone) : '—'}.`;
        setNotice({
          tone: liveUpdated ? 'ok' : 'error',
          text: `${contest.name} is ${updated.status}. ${stamp}${
            liveUpdated
              ? ''
              : ' Results pages were not told (Redis unavailable); they show it on reload.'
          }`,
        });
      } else {
        const failure = ErrorResponse.safeParse(json);
        setNotice({
          tone: 'error',
          text: failure.data?.issues[0]?.message ?? `Failed (HTTP ${res.status}).`,
        });
      }
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/contests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const json: unknown = await res.json();
      if (res.ok) {
        // Next step: its contestants.
        router.push(`/admin/contestants?contest=${(json as Contest).id}`);
        return;
      }
      const failure = ErrorResponse.safeParse(json);
      const issue = failure.data?.issues[0];
      setCreateError(
        issue
          ? `${issue.path === 'name' && res.status === 400 ? 'Name ' : ''}${issue.message}`
          : `Failed (HTTP ${res.status}).`,
      );
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(contest: Contest) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/contests/${contest.id}`, { method: 'DELETE' });
      if (res.ok) {
        setNotice({ tone: 'ok', text: `${contest.name} was deleted.` });
      } else {
        const failure = ErrorResponse.safeParse(await res.json().catch(() => null));
        setNotice({
          tone: 'error',
          text: failure.data?.issues[0]?.message ?? `Failed (HTTP ${res.status}).`,
        });
      }
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-muted-foreground uppercase">Tally · admin</p>
          <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">Contests</h1>
        </div>
        <Button
          data-testid="new-contest"
          onClick={() => {
            setNewName('');
            setCreateError(null);
            setCreating(true);
          }}
        >
          <Plus /> New contest
        </Button>
      </header>

      {notice && (
        <p
          role="status"
          data-testid="notice"
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.tone === 'ok' ? 'bg-muted/40' : 'border-destructive/40 bg-destructive/10'
          }`}
        >
          {notice.text}
        </p>
      )}

      <fieldset className="flex flex-wrap gap-2" data-testid="status-filter">
        <legend className="sr-only">Show</legend>
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'secondary' : 'ghost'}
            aria-pressed={filter === f}
            data-filter={f}
            onClick={() => chooseFilter(f)}
          >
            {FILTER_LABEL[f]}
            <span className="tabular-nums text-muted-foreground">{count(f)}</span>
          </Button>
        ))}
      </fieldset>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contest</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Contestants</TableHead>
              <TableHead>Window opened</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No {filter === 'all' ? '' : `${filter} `}contests.
                </TableCell>
              </TableRow>
            )}
            {shown.map((c) => {
              const action = ACTION[c.status];
              return (
                <TableRow key={c.id} data-contest={c.id} data-status={c.status}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge className={`uppercase ${STATUS_TONE[c.status]}`}>{c.status}</Badge>
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`contestants-${c.id}`}
                  >
                    {contestantCounts[c.id] ?? 0}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {c.opensAt ? (
                      <Time iso={c.opensAt} />
                    ) : c.status === 'draft' ? (
                      '—'
                    ) : (
                      'since creation'
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {c.closesAt ? <Time iso={c.closesAt} /> : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/admin/contestants?contest=${c.id}`}>
                          <Users /> Contestants
                        </a>
                      </Button>
                      {c.status !== 'draft' && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/admin/recap/${c.id}`} data-testid={`recap-${c.id}`}>
                            <Clapperboard /> Recap
                          </a>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/results/${c.id}`} target="_blank" rel="noreferrer">
                          Results <ExternalLink />
                        </a>
                      </Button>
                      {action && (
                        <Button
                          size="sm"
                          data-testid={`status-${c.id}`}
                          variant={action.to === 'closed' ? 'destructive' : 'default'}
                          onClick={() => setConfirm({ contest: c, to: action.to })}
                        >
                          {action.label}
                        </Button>
                      )}
                      {c.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`delete-${c.id}`}
                          aria-label={`Delete ${c.name}`}
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {ACTION[confirm.contest.status]?.label}: {confirm.contest.name}?
                </DialogTitle>
                <DialogDescription>{EXPLAIN[confirm.contest.status]}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  data-testid="confirm-status"
                  variant={confirm.to === 'closed' ? 'destructive' : 'default'}
                  disabled={busy}
                  onClick={() => apply(confirm)}
                >
                  {busy ? 'Working…' : ACTION[confirm.contest.status]?.label}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={(open) => !busy && setCreating(open)}>
        <DialogContent>
          <form onSubmit={create} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New contest</DialogTitle>
              <DialogDescription>
                It starts as a draft: add its contestants, then open voting. Votes sent to a draft
                are not counted.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="contest-name">Name</Label>
              <Input
                id="contest-name"
                name="name"
                value={newName}
                maxLength={80}
                autoFocus
                required
                aria-invalid={createError !== null}
                aria-describedby={createError ? 'contest-name-error' : undefined}
                onChange={(e) => setNewName(e.target.value)}
              />
              {createError && (
                <p id="contest-name-error" role="alert" className="text-sm text-destructive">
                  {createError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="create-contest" disabled={busy || !newName.trim()}>
                {busy ? 'Creating…' : 'Create draft'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <DialogContent>
          {deleting && (
            <>
              <DialogHeader>
                <DialogTitle>Delete {deleting.name}?</DialogTitle>
                <DialogDescription>
                  The draft and its {contestantCounts[deleting.id] ?? 0} contestants are removed. It
                  has never been open, so no results are lost.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  data-testid="confirm-delete"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => remove(deleting)}
                >
                  {busy ? 'Deleting…' : 'Delete draft'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
