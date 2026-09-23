/**
 * A country's flag emoji from its ISO 3166-1 alpha-2 code, built from regional indicator
 * letters, so no image is fetched. Null for anything that isn't two letters.
 */
export function flagEmoji(countryCode: string | null | undefined): string | null {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  const base = 0x1f1e6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => base + c.charCodeAt(0)));
}
