import { describe, expect, it } from 'vitest';
import { ContestantBatchCreate, ContestantCreate, ContestantUpdate } from './contestant.ts';

const CONTEST = '0192f3a0-7c1e-7000-8000-00000000c0de';
const issuePaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('ContestantCreate', () => {
  it('normalises what voters and the scoreboard see: code and country uppercased, colours uppercased', () => {
    expect(
      ContestantCreate.parse({
        contestId: CONTEST,
        code: ' c11 ',
        name: '  Wren Castellane ',
        countryCode: 'fr',
        accentFrom: '#0ea5e9',
      }),
    ).toEqual({
      contestId: CONTEST,
      code: 'C11',
      name: 'Wren Castellane',
      imageUrl: null,
      accentFrom: '#0EA5E9',
      accentTo: null,
      countryCode: 'FR',
    });
  });

  it('rejects codes voters could not send, unknown countries, bad colours and non-https images', () => {
    const r = ContestantCreate.safeParse({
      contestId: CONTEST,
      code: 'C-11',
      name: '',
      countryCode: 'ZZ',
      accentTo: 'blue',
      imageUrl: 'http://example.com/a.png',
    });
    expect(issuePaths(r).sort()).toEqual(['accentTo', 'code', 'countryCode', 'imageUrl', 'name']);
  });
});

describe('ContestantUpdate', () => {
  it('accepts any subset of the editable fields, including deactivation', () => {
    expect(ContestantUpdate.parse({ active: false })).toEqual({ active: false });
    expect(ContestantUpdate.parse({ countryCode: null, name: 'X' })).toEqual({
      countryCode: null,
      name: 'X',
    });
  });

  it('refuses to change the code: consumers cache it', () => {
    expect(ContestantUpdate.safeParse({ code: 'C99' }).success).toBe(false);
    expect(ContestantUpdate.safeParse({ name: 'X', contestId: CONTEST }).success).toBe(false);
  });

  it('refuses an empty change', () => {
    expect(ContestantUpdate.safeParse({}).success).toBe(false);
  });
});

describe('ContestantBatchCreate', () => {
  it('refuses a code used twice in the batch, pointing at the second row', () => {
    const r = ContestantBatchCreate.safeParse({
      contestId: CONTEST,
      contestants: [
        { code: 'A1', name: 'One' },
        { code: 'a1 ', name: 'Two' },
      ],
    });
    expect(issuePaths(r)).toEqual(['contestants.1.code']);
  });

  it('refuses an empty batch', () => {
    expect(ContestantBatchCreate.safeParse({ contestId: CONTEST, contestants: [] }).success).toBe(
      false,
    );
  });
});
