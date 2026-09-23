import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node24',
  // Workspace packages ship TypeScript source, so they are bundled in. Their own runtime
  // dependencies (e.g. pg for @tally/db) must be listed in this package's dependencies, or
  // tsup inlines them too and CommonJS modules break at runtime.
  noExternal: [/^@tally\//],
  clean: true,
});
