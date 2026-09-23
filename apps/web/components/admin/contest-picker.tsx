'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Contest = { id: string; name: string; status: string };

/** Switches an admin page's `?contest=`; `allValue` adds an "All contests" option. */
export function ContestPicker(props: {
  contests: Contest[];
  value: string;
  basePath: string;
  allValue?: string;
}) {
  const { contests, value, basePath, allValue } = props;
  const router = useRouter();
  return (
    <Select value={value} onValueChange={(id) => router.push(`${basePath}?contest=${id}`)}>
      <SelectTrigger className="w-64" aria-label="Contest" data-testid="contest-picker">
        <SelectValue placeholder="Choose a contest" />
      </SelectTrigger>
      <SelectContent>
        {allValue && <SelectItem value={allValue}>All contests</SelectItem>}
        {contests.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name} <span className="text-muted-foreground">· {c.status}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
