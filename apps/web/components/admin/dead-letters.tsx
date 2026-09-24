'use client';

import type { DeadLetterCounts, DeadLetterReason, DeadLetterRow } from '@tally/contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { ClockTime } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const POLL_MS = 3000;

const REASON_TONE: Record<DeadLetterReason, string> = {
  unknown_code: 'bg-warn/15 text-warn border-warn/30',
  inactive_contestant: 'bg-chart-1/15 text-chart-1 border-chart-1/30',
  contest_closed: 'bg-muted text-muted-foreground',
  malformed: 'bg-destructive/15 text-destructive border-destructive/30',
};

/** What a payload says, if it's a vote at all. Malformed ones may hold anything. */
function summary(payload: unknown) {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  return { code: str('code'), source: str('source'), raw: str('raw') };
}

/** Dead letters, one per row; click a row to see the payload exactly as it was received. */
export function DeadLetterTable(props: {
  items: DeadLetterRow[];
  contestNames: Record<string, string>;
  reasonLabels: Record<DeadLetterReason, string>;
}) {
  const { items, contestNames, reasonLabels } = props;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>#</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Contest</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Idempotency key</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                No dead letters here.
              </TableCell>
            </TableRow>
          )}
          {items.map((d) => {
            const s = summary(d.payload);
            const expanded = open.has(d.id);
            return (
              <Fragment key={d.id}>
                <TableRow
                  data-testid="dead-letter"
                  data-id={d.id}
                  data-reason={d.reason}
                  data-code={s.code ?? ''}
                  className="cursor-pointer"
                  onClick={() => toggle(d.id)}
                  aria-expanded={expanded}
                >
                  <TableCell className="text-muted-foreground">
                    {expanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{d.id}</TableCell>
                  <TableCell className="tabular-nums">
                    <ClockTime iso={d.receivedAt} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={REASON_TONE[d.reason]}>
                      {reasonLabels[d.reason]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{s.code ?? '—'}</TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {d.contestId
                      ? (contestNames[d.contestId] ??
                        `${d.contestId.slice(0, 8)}… (no such contest)`)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.source ?? '—'}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
                    {d.idempotencyKey ?? '—'}
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell />
                    <TableCell colSpan={7}>
                      <pre
                        data-testid="payload"
                        className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap"
                      >
                        {JSON.stringify(d.payload, null, 2)}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * "124 new dead letters · show newest": polls a count of rows above the newest one this page
 * knows about. The list itself never moves on its own, so it doesn't jump while being read.
 */
export function NewDeadLetters(props: {
  contestId: string | undefined;
  reason: DeadLetterReason | undefined;
  since: number;
  newestHref: string;
}) {
  const { contestId, reason, since, newestHref } = props;
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    setFresh(0);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const params = new URLSearchParams({ since: String(since) });
        if (contestId) params.set('contestId', contestId);
        const res = await fetch(`/api/dead-letters/counts?${params}`, { cache: 'no-store' });
        if (res.ok) {
          const counts = (await res.json()) as DeadLetterCounts;
          setFresh(reason ? counts.byReason[reason] : counts.total);
        }
      } catch {
        // Transient: the next poll tries again.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [contestId, reason, since]);

  if (fresh === 0) return null;
  return (
    <p
      role="status"
      data-testid="new-banner"
      data-value={fresh}
      className="flex items-center justify-between rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-sm"
    >
      <span>
        <strong className="tabular-nums">{fresh.toLocaleString('en')}</strong> new dead letter
        {fresh === 1 ? '' : 's'} since this page loaded.
      </span>
      <Link
        href={newestHref}
        className="font-medium underline-offset-4 hover:underline"
        data-testid="show-new"
      >
        Show newest
      </Link>
    </p>
  );
}
