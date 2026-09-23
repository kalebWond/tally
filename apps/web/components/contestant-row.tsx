import Image from 'next/image';
import type { CSSProperties } from 'react';
import type { Standing } from '@/lib/standings';
import { AnimatedNumber } from './animated-number';

const DEFAULT_FROM = '#4B5563';
const DEFAULT_TO = '#1F2937';

/**
 * One contestant in the standings. Keyed by contestant id by its parent so F10's layout
 * animation can track it across reorders. F24's card grid reuses this component with a layout
 * flag rather than forking it.
 */
interface Props {
  standing: Standing;
  leader: boolean;
  /** Before the first snapshot the total is unknown, so show a dash rather than a false zero. */
  synced: boolean;
}

export function ContestantRow({ standing, leader, synced }: Props) {
  const from = standing.accentFrom ?? DEFAULT_FROM;
  const to = standing.accentTo ?? DEFAULT_TO;

  return (
    <li
      className="row"
      data-leader={leader || undefined}
      data-code={standing.code}
      style={{ '--accent-from': from, '--accent-to': to } as CSSProperties}
    >
      <span className="row-rank">
        <span className="sr-only">Rank </span>
        {standing.rank}
      </span>
      <span className="row-stripe" aria-hidden="true" />
      {standing.imageUrl ? (
        // Generated SVG avatars: nothing for the optimiser to do, so serve them as-is.
        <Image
          className="row-avatar"
          src={standing.imageUrl}
          alt=""
          width={52}
          height={52}
          unoptimized
        />
      ) : (
        <span className="row-avatar" aria-hidden="true" />
      )}
      <span className="row-who">
        <span className="row-name">{standing.name}</span>
        <span className="row-meta">
          <span className="row-code">{standing.code}</span>
          {standing.countryCode && <span className="row-country">{standing.countryCode}</span>}
        </span>
      </span>
      {synced ? (
        <AnimatedNumber
          className="row-total"
          value={standing.total}
          data-testid={`total-${standing.code}`}
        />
      ) : (
        <span className="row-total">–</span>
      )}
    </li>
  );
}
