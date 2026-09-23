import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsonSchemas, schemaFile, serialize } from './json-schemas.ts';

// The Go generator reads these files; if Zod changes and they aren't regenerated, the Go
// contract test would be checking against a stale contract. Fix: pnpm --filter @tally/contracts export-schemas
describe('exported JSON Schemas', () => {
  it.each(Object.entries(jsonSchemas()))('schemas/%s is up to date with Zod', (name, schema) => {
    const committed = readFileSync(
      new URL(`../schemas/${schemaFile(name)}`, import.meta.url),
      'utf8',
    );
    expect(committed).toBe(serialize(schema));
  });
});
