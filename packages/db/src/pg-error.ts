/** Postgres error code, whether pg's error arrives bare or wrapped by Drizzle. */
export function pgCode(err: unknown): string | undefined {
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}
