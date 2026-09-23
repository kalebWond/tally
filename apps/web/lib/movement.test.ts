import { describe, expect, it } from 'vitest';
import { movements } from './movement';

describe('movements', () => {
  it('marks the overtaker as rising and the overtaken as falling', () => {
    expect(movements(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual(
      new Map([
        ['b', 'up'],
        ['a', 'down'],
      ]),
    );
  });

  it('a jump over several rows makes one riser and several fallers', () => {
    const moved = movements(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c']);
    expect(moved.get('d')).toBe('up');
    expect(['a', 'b', 'c'].map((id) => moved.get(id))).toEqual(['down', 'down', 'down']);
  });

  it('reports nothing when the order is unchanged', () => {
    expect(movements(['a', 'b'], ['a', 'b']).size).toBe(0);
  });

  it('reports nothing on first render, when there is no previous order', () => {
    expect(movements(undefined, ['a', 'b']).size).toBe(0);
  });

  it('ignores rows that just appeared (a contestant added mid-contest)', () => {
    expect(movements(['a', 'b'], ['c', 'a', 'b']).has('c')).toBe(false);
  });
});
