import { describe, expect, it } from 'vitest';
import { flagEmoji } from './flag';

describe('flagEmoji', () => {
  it('builds the flag from regional indicator letters, whatever the case', () => {
    expect(flagEmoji('NO')).toBe('🇳🇴');
    expect(flagEmoji('jp')).toBe('🇯🇵');
  });

  it('gives nothing for a missing or malformed code', () => {
    for (const code of [null, undefined, '', 'N', 'NOR', '1A']) expect(flagEmoji(code)).toBeNull();
  });
});
