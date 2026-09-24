'use client';

import { avatarUrl, type Contestant, ErrorResponse } from '@tally/contracts';
import { Shuffle, X } from 'lucide-react';
import Image from 'next/image';
import { type FormEvent, useState } from 'react';
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
import { type SampleContestant, sampleContestants } from '@/lib/sample-contestants';

type Draft = SampleContestant & { key: number };
type Field = keyof SampleContestant;

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
let nextKey = 0;

/**
 * "Fill with sample contestants" (F27): invented contestants to review, edit or remove before
 * anything is saved. Submitting adds exactly the rows on screen, all together or none.
 */
export function SampleContestants(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contestId: string;
  contestName: string;
  existing: Pick<Contestant, 'code' | 'name'>[];
  onAdded: (added: Contestant[]) => void;
}) {
  const { open, onOpenChange, contestId, contestName, existing, onAdded } = props;
  const draw = () =>
    sampleContestants({
      contestName,
      takenCodes: existing.map((c) => c.code),
      takenNames: existing.map((c) => c.name),
    }).map((c) => ({ ...c, key: nextKey++ }));

  const [rows, setRows] = useState<Draft[]>([]);
  /** Errors by row key and field, plus one for the whole batch. */
  const [errors, setErrors] = useState<Record<number, Partial<Record<Field, string>>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh draw each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRows(draw());
      setErrors({});
      setFormError(null);
    }
  }

  const edit = (key: number, field: Field, value: string) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    setErrors((prev) => {
      const row = prev[key];
      if (!row?.[field]) return prev;
      const { [field]: _, ...rest } = row;
      return { ...prev, [key]: rest };
    });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const res = await fetch('/api/contestants/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contestId,
          contestants: rows.map(({ key: _, ...r }) => ({
            ...r,
            imageUrl: r.name.trim() ? avatarUrl(r.name.trim()) : null,
            countryCode: r.countryCode.trim() || null,
          })),
        }),
      });
      const json: unknown = await res.json();
      if (res.ok) {
        onAdded(json as Contestant[]);
        return;
      }
      const issues = ErrorResponse.safeParse(json).data?.issues ?? [];
      const byRow: Record<number, Partial<Record<Field, string>>> = {};
      const general: string[] = [];
      for (const issue of issues) {
        const [, index, field] = issue.path.match(/^contestants\.(\d+)\.(\w+)$/) ?? [];
        const row = rows[Number(index)];
        if (row && field) byRow[row.key] = { ...byRow[row.key], [field as Field]: issue.message };
        else general.push(issue.message);
      }
      setErrors(byRow);
      setFormError(
        general.join(' ') ||
          (issues.length
            ? `Nothing was added. Fix the ${Object.keys(byRow).length === 1 ? 'row' : 'rows'} marked below.`
            : `Failed (HTTP ${res.status}).`),
      );
    } catch {
      setFormError('Could not reach the server. Nothing was added.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-5xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Sample contestants for {contestName}</DialogTitle>
            <DialogDescription>
              Invented names with generated avatars. Edit or remove any row, or reshuffle. Nothing
              is saved until you add them.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <p
              role="alert"
              data-testid="samples-error"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
            >
              {formError}
            </p>
          )}

          <div className="max-h-[60vh] overflow-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="w-12 px-3 py-2" />
                  <th className="w-24 px-2 py-2">Code</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="w-40 px-2 py-2">Country</th>
                  <th className="w-28 px-2 py-2">Accent</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e = errors[r.key] ?? {};
                  return (
                    <tr key={r.key} data-sample={i} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div
                          className="size-9 overflow-hidden rounded-full border"
                          style={{
                            background: `linear-gradient(135deg, ${r.accentFrom}, ${r.accentTo})`,
                          }}
                        >
                          {r.name.trim() && (
                            <Image
                              src={avatarUrl(r.name.trim())}
                              alt=""
                              width={36}
                              height={36}
                              unoptimized
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          id={`sample-${r.key}-code`}
                          aria-label={`Row ${i + 1} code`}
                          aria-invalid={!!e.code}
                          className="font-mono uppercase"
                          value={r.code}
                          maxLength={16}
                          onChange={(ev) => edit(r.key, 'code', ev.target.value)}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          id={`sample-${r.key}-name`}
                          aria-label={`Row ${i + 1} name`}
                          aria-invalid={!!e.name}
                          value={r.name}
                          maxLength={80}
                          onChange={(ev) => edit(r.key, 'name', ev.target.value)}
                        />
                        {(e.code || e.name || e.countryCode || e.accentFrom || e.accentTo) && (
                          <p
                            role="alert"
                            data-testid={`sample-error-${i}`}
                            className="mt-1 text-xs text-destructive"
                          >
                            {[e.code, e.name, e.countryCode, e.accentFrom, e.accentTo]
                              .filter(Boolean)
                              .join(' ')}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          id={`sample-${r.key}-country`}
                          aria-label={`Row ${i + 1} country code`}
                          aria-invalid={!!e.countryCode}
                          className="w-16 font-mono uppercase"
                          value={r.countryCode}
                          maxLength={2}
                          onChange={(ev) => edit(r.key, 'countryCode', ev.target.value)}
                        />
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {safeRegion(r.countryCode)}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <input
                            type="color"
                            id={`sample-${r.key}-from`}
                            aria-label={`Row ${i + 1} accent start`}
                            className="h-9 w-11 cursor-pointer rounded border bg-transparent"
                            value={r.accentFrom.toLowerCase()}
                            onChange={(ev) =>
                              edit(r.key, 'accentFrom', ev.target.value.toUpperCase())
                            }
                          />
                          <input
                            type="color"
                            id={`sample-${r.key}-to`}
                            aria-label={`Row ${i + 1} accent end`}
                            className="h-9 w-11 cursor-pointer rounded border bg-transparent"
                            value={r.accentTo.toLowerCase()}
                            onChange={(ev) =>
                              edit(r.key, 'accentTo', ev.target.value.toUpperCase())
                            }
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${r.name || `row ${i + 1}`}`}
                          data-testid={`remove-sample-${i}`}
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <X />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      Every row was removed. Reshuffle for a new set.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              data-testid="reshuffle-samples"
              disabled={saving}
              onClick={() => {
                setRows(draw());
                setErrors({});
                setFormError(null);
              }}
            >
              <Shuffle /> Reshuffle
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="add-samples" disabled={saving || !rows.length}>
                {saving
                  ? 'Adding…'
                  : `Add ${rows.length} contestant${rows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The country's name while the code is valid; nothing while it's being typed. */
function safeRegion(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  try {
    const name = regions.of(code.toUpperCase());
    return name && name !== code.toUpperCase() && name !== 'Unknown Region' ? name : '';
  } catch {
    return '';
  }
}
