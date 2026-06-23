import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit CLI doesn't auto-load .env.local (Next.js convention), so we load it here.
config({ path: '.env.local', override: true });

// All of this app's tables live under the dedicated `confirmation` Postgres schema
// so they coexist cleanly with the future shared sales-platform tables
// (PROJECT_BRIEF.md §15 — shared DB decision).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['confirmation'],
  dbCredentials: {
    // Use the direct (non-pooled) connection for DDL — the pooler rejects schema changes.
    // Set DATABASE_DIRECT_URL (port 5432) for migrations; DATABASE_URL (port 6543) for the app.
    url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
