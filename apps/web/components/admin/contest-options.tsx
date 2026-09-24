'use client';

import { Fragment } from 'react';
import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from '@/components/ui/select';

type Contest = { id: string; name: string; status: string };

const GROUPS = [
  ['open', 'Open'],
  ['draft', 'Draft'],
  ['closed', 'Closed'],
] as const;

/**
 * A contest picker's options (F30): grouped under Open, Draft and Closed, each group in the
 * list's order (newest first). Shared by every contest picker so they stay alike.
 */
export function ContestOptions({ contests }: { contests: Contest[] }) {
  const groups = GROUPS.map(([status, label]) => ({
    status,
    label,
    items: contests.filter((c) => c.status === status),
  })).filter((g) => g.items.length > 0);
  return groups.map((g, i) => (
    <Fragment key={g.status}>
      {i > 0 && <SelectSeparator />}
      <SelectGroup data-group={g.status}>
        <SelectLabel>{g.label}</SelectLabel>
        {g.items.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
    </Fragment>
  ));
}
