import { defineConfig } from 'drizzle-kit';

// `generate` only diffs the schema against earlier migrations; it never connects to a database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: '../../infra/migrations',
});
