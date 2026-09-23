import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node24',
  // Workspace packages ship TypeScript source, so they are bundled in; their runtime
  // dependencies must also be listed in this package's dependencies.
  noExternal: [/^@tally\//],
  clean: true,
});
