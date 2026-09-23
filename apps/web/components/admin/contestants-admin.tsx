'use client';

import type { Contestant } from '@tally/contracts';
import { ExternalLink, Pencil, Plus } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ContestantForm } from './contestant-form';

type Contest = { id: string; name: string; status: string };
type Row = Contestant & { votes: number };

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

export function ContestantsAdmin(props: {
  contests: Contest[];
  contestId: string | undefined;
  contestants: Row[];
}) {
  const { contests, contestId, contestants } = props;
  const router = useRouter();
  /** undefined = closed, null = adding, a contestant = editing it. */
  const [dialog, setDialog] = useState<Row | null | undefined>(undefined);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  function saved(c: Contestant) {
    const added = dialog === null;
    setDialog(undefined);
    setNotice({
      tone: 'ok',
      text: added
        ? `${c.name} added as ${c.code}. Votes for ${c.code} count from now on.`
        : `${c.name} saved.`,
    });
    router.refresh();
  }

  async function setActive(row: Row, active: boolean) {
    setToggling(row.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/contestants/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotice({
        tone: 'ok',
        text: active
          ? `${row.name} is active again: votes for ${row.code} count within 5 s.`
          : `${row.name} deactivated: from within 5 s, votes for ${row.code} go to dead letters. Existing votes stay.`,
      });
      router.refresh();
    } catch (err) {
      setNotice({
        tone: 'error',
        text: `Could not change ${row.name}: ${(err as Error).message}.`,
      });
    } finally {
      setToggling(null);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-muted-foreground uppercase">Tally · admin</p>
          <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">Contestants</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={contestId ?? ''}
            onValueChange={(id) => router.push(`/admin/contestants?contest=${id}`)}
          >
            <SelectTrigger className="w-64" aria-label="Contest">
              <SelectValue placeholder="Choose a contest" />
            </SelectTrigger>
            <SelectContent>
              {contests.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} <span className="text-muted-foreground">· {c.status}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contestId && (
            <Button variant="outline" asChild>
              <a href={`/results/${contestId}`} target="_blank" rel="noreferrer">
                Results <ExternalLink />
              </a>
            </Button>
          )}
          <Button
            data-testid="add-contestant"
            disabled={!contestId}
            onClick={() => setDialog(null)}
          >
            <Plus /> Add contestant
          </Button>
        </div>
      </header>

      {notice && (
        <p
          role="status"
          data-testid="notice"
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.tone === 'ok'
              ? 'border-line bg-muted/40'
              : 'border-destructive/40 bg-destructive/10'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Accent</TableHead>
              <TableHead className="text-right">Votes</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contestants.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No contestants yet.
                </TableCell>
              </TableRow>
            )}
            {contestants.map((c) => (
              <TableRow
                key={c.id}
                data-code={c.code}
                data-active={c.active}
                className={c.active ? '' : 'opacity-55'}
              >
                <TableCell>
                  <div className="size-9 overflow-hidden rounded-full border bg-muted">
                    {c.imageUrl && (
                      <Image src={c.imageUrl} alt="" width={36} height={36} unoptimized />
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                <TableCell>
                  {c.name}
                  {!c.active && (
                    <Badge variant="outline" className="ml-2">
                      inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.countryCode
                    ? `${regions.of(c.countryCode) ?? c.countryCode} (${c.countryCode})`
                    : '—'}
                </TableCell>
                <TableCell>
                  <span
                    className="block h-4 w-14 rounded-full border"
                    style={{
                      background:
                        c.accentFrom || c.accentTo
                          ? `linear-gradient(90deg, ${c.accentFrom ?? c.accentTo}, ${c.accentTo ?? c.accentFrom})`
                          : undefined,
                    }}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.votes.toLocaleString('en')}
                </TableCell>
                <TableCell>
                  <Switch
                    data-testid={`active-${c.code}`}
                    checked={c.active}
                    disabled={toggling === c.id}
                    onCheckedChange={(on) => setActive(c, on)}
                    aria-label={`${c.name} active`}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-testid={`edit-${c.code}`}
                    onClick={() => setDialog(c)}
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog !== undefined} onOpenChange={(open) => !open && setDialog(undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog ? `Edit ${dialog.name}` : 'Add contestant'}</DialogTitle>
            <DialogDescription>
              {dialog
                ? 'Changes show on results pages when they next load.'
                : 'Votes for the new code count as soon as it is saved.'}
            </DialogDescription>
          </DialogHeader>
          {contestId && dialog !== undefined && (
            <ContestantForm
              key={dialog?.id ?? 'new'}
              contestId={contestId}
              editing={dialog ?? undefined}
              onSaved={saved}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
