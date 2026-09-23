'use client';

import { type Contest, ErrorResponse } from '@tally/contracts';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

const when = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : '—');

export function ContestsAdmin({ contests }: { contests: Contest[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Action | null>(null);
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
            ? `Cut-off: ${when(updated.closesAt)}.`
            : `Open since ${when(updated.opensAt)}.`;
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

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <header>
        <p className="text-sm tracking-widest text-muted-foreground uppercase">Tally · admin</p>
        <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">Contests</h1>
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

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contest</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Window opened</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((c) => {
              const action = ACTION[c.status];
              return (
                <TableRow key={c.id} data-contest={c.id} data-status={c.status}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge className={`uppercase ${STATUS_TONE[c.status]}`}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {c.opensAt ? when(c.opensAt) : c.status === 'draft' ? '—' : 'since creation'}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {when(c.closesAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
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
    </main>
  );
}
