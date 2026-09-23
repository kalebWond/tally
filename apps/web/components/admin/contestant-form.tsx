'use client';

import { avatarUrl, type Contestant, ErrorResponse } from '@tally/contracts';
import { Sparkles } from 'lucide-react';
import Image from 'next/image';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  const name = regions.of(code.toUpperCase());
  return name && name !== code.toUpperCase() && name !== 'Unknown Region' ? name : null;
};

type Fields = {
  code: string;
  name: string;
  imageUrl: string;
  accentFrom: string;
  accentTo: string;
  countryCode: string;
};

const blank: Fields = {
  code: '',
  name: '',
  imageUrl: '',
  accentFrom: '',
  accentTo: '',
  countryCode: '',
};
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/**
 * Add or edit one contestant. Validation is the server's (the contract schemas); this form
 * only shows what it says, next to the field it names. The code is fixed after creation.
 */
export function ContestantForm(props: {
  contestId: string;
  editing?: Contestant | undefined;
  onSaved: (c: Contestant) => void;
}) {
  const { contestId, editing, onSaved } = props;
  const [f, setF] = useState<Fields>(
    editing
      ? {
          code: editing.code,
          name: editing.name,
          imageUrl: editing.imageUrl ?? '',
          accentFrom: editing.accentFrom ?? '',
          accentTo: editing.accentTo ?? '',
          countryCode: editing.countryCode ?? '',
        }
      : blank,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Fields) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const details = {
      name: f.name,
      imageUrl: orNull(f.imageUrl),
      accentFrom: orNull(f.accentFrom),
      accentTo: orNull(f.accentTo),
      countryCode: orNull(f.countryCode),
    };
    try {
      const res = await fetch(editing ? `/api/contestants/${editing.id}` : '/api/contestants', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editing ? details : { contestId, code: f.code, ...details }),
      });
      const json: unknown = await res.json();
      if (res.ok) return onSaved(json as Contestant);
      const failure = ErrorResponse.safeParse(json);
      const next: Record<string, string> = {};
      for (const issue of failure.success ? failure.data.issues : [])
        next[issue.path || 'form'] ??= issue.message;
      if (Object.keys(next).length === 0) next.form = `Saving failed (HTTP ${res.status}).`;
      setErrors(next);
    } catch {
      setErrors({ form: 'Could not reach the server.' });
    } finally {
      setSaving(false);
    }
  }

  const preview = f.imageUrl.startsWith('https://') ? f.imageUrl : null;
  const country = countryName(f.countryCode);

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <FormField
          id="code"
          label="Code"
          error={errors.code}
          hint={editing ? 'Fixed after creation' : 'What voters send'}
        >
          <Input
            id="code"
            name="code"
            value={f.code}
            onChange={(e) => set('code')(e.target.value.toUpperCase())}
            disabled={!!editing}
            maxLength={16}
            autoComplete="off"
            className="font-mono uppercase"
            aria-invalid={errors.code ? true : undefined}
          />
        </FormField>
        <FormField id="name" label="Name" error={errors.name}>
          <Input
            id="name"
            name="name"
            value={f.name}
            onChange={(e) => set('name')(e.target.value)}
            maxLength={80}
            aria-invalid={errors.name ? true : undefined}
          />
        </FormField>
      </div>

      <FormField
        id="imageUrl"
        label="Image URL"
        error={errors.imageUrl}
        hint="Illustrated or generated only: no photos of real people"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border bg-muted">
            {preview && <Image src={preview} alt="" width={48} height={48} unoptimized />}
          </div>
          <Input
            id="imageUrl"
            name="imageUrl"
            value={f.imageUrl}
            onChange={(e) => set('imageUrl')(e.target.value)}
            placeholder="https://…"
            aria-invalid={errors.imageUrl ? true : undefined}
          />
          <Button
            type="button"
            variant="outline"
            data-testid="generate-avatar"
            disabled={!f.name.trim()}
            onClick={() => set('imageUrl')(avatarUrl(f.name.trim()))}
            title="Generate an illustrated avatar from the name"
          >
            <Sparkles /> Generate
          </Button>
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <ColourField
          id="accentFrom"
          label="Accent from"
          value={f.accentFrom}
          onChange={set('accentFrom')}
          error={errors.accentFrom}
        />
        <ColourField
          id="accentTo"
          label="Accent to"
          value={f.accentTo}
          onChange={set('accentTo')}
          error={errors.accentTo}
        />
      </div>

      <FormField
        id="countryCode"
        label="Country"
        error={errors.countryCode}
        hint={country ?? 'Two-letter code, e.g. FR'}
      >
        <Input
          id="countryCode"
          name="countryCode"
          value={f.countryCode}
          onChange={(e) => set('countryCode')(e.target.value.toUpperCase())}
          maxLength={2}
          className="w-24 font-mono uppercase"
          aria-invalid={errors.countryCode ? true : undefined}
        />
      </FormField>

      {errors.form && (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      )}
      <Button type="submit" data-testid="save-contestant" disabled={saving}>
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Add contestant'}
      </Button>
    </form>
  );
}

function FormField(props: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  const { id, label, error, hint, children } = props;
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p data-testid={`error-${id}`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Hex text (empty = none) with a native colour picker beside it. */
function ColourField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const { id, label, value, onChange, error } = props;
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <FormField id={id} label={label} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value.toLowerCase() : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input
          id={id}
          name={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#RRGGBB"
          maxLength={7}
          className="font-mono uppercase"
          aria-invalid={error ? true : undefined}
        />
      </div>
    </FormField>
  );
}
