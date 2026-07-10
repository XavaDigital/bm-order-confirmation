import { defineConfig, devices } from '@playwright/test';

/**
 * e2e specs run against a production build + your actual dev database
 * (DATABASE_URL in .env.local) — there is no isolated test DB for this
 * project. `next build && next start` is used instead of `next dev`
 * deliberately: dev mode compiles each route on first visit (multi-second
 * delays that make time-boxed TOTP codes go stale mid-test) and renders a
 * dev-tools overlay badge that intercepts clicks on whatever it happens to
 * sit on top of — both caused real flakiness here.
 *
 * They run on a dedicated port with their own spawned server
 * (reuseExistingServer: false), specifically so they never silently attach
 * to a server you already have running on a common port and inherit its
 * real SMTP config. SMTP_HOST is force-disabled here so no real emails go
 * out; the "Generate link" flow (which returns the URL directly in the
 * response) is used everywhere instead of "Email to customer". Test data is
 * tagged with an `e2e-` prefix so it's easy to spot and isn't otherwise
 * cleaned up automatically (the app has no hard-delete for non-draft orders
 * by design — see CLAUDE.md's "migrations are additive" note).
 */
const PORT = 4177;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Generous timeouts: specs hit a real remote Postgres instance (Supabase),
  // whose latency/load is more variable than a local test DB — individual
  // page loads have been observed anywhere from ~1s to ~20s.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // The dev DB is a real pooled Supabase Postgres instance (transaction-mode
  // pooler) with variable network latency from this machine — occasionally
  // a page load or a query is just slow, or the pooler cancels a query with
  // a hard server-side "statement timeout" under load. Both are transient
  // infra characteristics of this environment, not test bugs. Retries absorb
  // that without masking a real failure (a genuine bug fails the same way
  // every time, not intermittently).
  retries: 2,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Force email off regardless of .env.local — Next.js won't reload a
      // key that's already present in the child process's environment.
      SMTP_HOST: '',
      // Customer/admin links embedded in emails and API responses must
      // point back at this dedicated e2e server, not the default :3000.
      APP_BASE_URL: BASE_URL,
    },
  },
});
