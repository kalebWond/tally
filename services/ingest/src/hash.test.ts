import { describe, expect, it } from 'vitest';
import { hashSender } from './hash.js';

describe('hashSender', () => {
  it('is stable for the same sender and salt', () => {
    expect(hashSender('+447700900123', 'salt-a')).toBe(hashSender('+447700900123', 'salt-a'));
  });

  it('changes with the salt, so hashes are useless without it', () => {
    expect(hashSender('+447700900123', 'salt-a')).not.toBe(hashSender('+447700900123', 'salt-b'));
  });

  it('ignores surrounding whitespace', () => {
    expect(hashSender(' +447700900123 ', 'salt-a')).toBe(hashSender('+447700900123', 'salt-a'));
  });

  it('produces 64 lowercase hex characters', () => {
    expect(hashSender('+447700900123', 'salt-a')).toMatch(/^[0-9a-f]{64}$/);
  });
});
