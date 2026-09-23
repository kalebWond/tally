import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The proxy is the admin surface's first filter (handlers re-check the session). A new API area
// once shipped without a matcher entry, unnoticed because the handler's own check still
// answered 401, so this keeps the two lists in step.

const web = path.join(import.meta.dirname, '..');
const matcher = [...readFileSync(path.join(web, 'proxy.ts'), 'utf8').matchAll(/'(\/[^']+)'/g)].map(
  (m) => m[1],
);

describe('proxy matcher', () => {
  it('covers every API area', () => {
    const areas = readdirSync(path.join(web, 'app/api'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/api/${d.name}/:path*`);
    expect(areas.length).toBeGreaterThan(0);
    expect(matcher).toEqual(expect.arrayContaining(areas));
  });

  it('covers the operator pages', () => {
    expect(matcher).toEqual(expect.arrayContaining(['/control/:path*', '/admin/:path*']));
  });
});
