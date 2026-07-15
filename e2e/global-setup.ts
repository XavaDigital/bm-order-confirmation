import { chromium, type FullConfig } from '@playwright/test';
import { SEED_ADMIN, STORAGE_STATE_PATH } from './helpers';

/**
 * The dashboard's first real request after the server boots hits a cold
 * Supabase connection pool (TLS handshake + several queries), which can
 * comfortably exceed a normal per-assertion timeout even though every
 * later request is fast. Absorb that one-time cold start here, outside any
 * individual test's budget, instead of retrying/timing out inside the suite.
 *
 * This is also the ONLY admin login most specs need: the resulting cookie is
 * saved to STORAGE_STATE_PATH and reused as every test's starting state (see
 * playwright.config.ts), so specs that don't test login itself skip
 * loginAsSeedAdmin() entirely. Keeps total logins per run well under the
 * real 10-attempts/15min/IP rate limiter (src/lib/rate-limit.ts) even with
 * a retry or two — auth.spec.ts opts back out of this shared state since it
 * exercises the login flow directly.
 */
export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('Email').fill(SEED_ADMIN.email);
  await page.getByPlaceholder('Password').fill(SEED_ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 60_000 });

  await page.context().storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}
