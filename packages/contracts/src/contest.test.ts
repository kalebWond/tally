import { describe, expect, it } from 'vitest';
import { ContestCreate } from './contest.ts';

describe('ContestCreate', () => {
  it('trims the name and collapses runs of spaces, so uniqueness sees one spelling', () => {
    expect(ContestCreate.parse({ name: '  Spring   Heats ' })).toEqual({ name: 'Spring Heats' });
  });

  it('refuses a blank or too-long name, and unknown fields', () => {
    expect(ContestCreate.safeParse({ name: '   ' }).success).toBe(false);
    expect(ContestCreate.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(ContestCreate.safeParse({ name: 'X', status: 'open' }).success).toBe(false);
  });
});
