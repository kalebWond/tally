export type Movement = 'up' | 'down';

/**
 * Which rows changed position between two orderings (arrays of ids, top first). Rows that are
 * new in `next` are ignored: appearing isn't overtaking.
 */
export function movements(
  prev: readonly string[] | undefined,
  next: readonly string[],
): Map<string, Movement> {
  const moved = new Map<string, Movement>();
  if (!prev) return moved;
  const before = new Map(prev.map((id, i) => [id, i]));
  next.forEach((id, i) => {
    const was = before.get(id);
    if (was === undefined || was === i) return;
    moved.set(id, was > i ? 'up' : 'down');
  });
  return moved;
}
