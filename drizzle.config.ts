import { defineConfig } from 'drizzle-kit';

// All of this app's tables live under the dedicated `confirmation` Postgres schema
// so they coexist cleanly with the future shared sales-platform tables
// (PROJECT_BRIEF.md §15 — shared DB decision).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['confirmation'],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
