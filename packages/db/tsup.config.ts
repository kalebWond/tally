import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin/migrate.ts', 'src/bin/seed.ts'],
  format: 'esm',
  target: 'node24',
  // Workspace packages ship TypeScript source, so they are bundled in.
  noExternal: [/^@tally\//],
  clean: true,
});
