import { chromium, type FullConfig } from '@playwright/test';
import { SEED_ADMIN } from './helpers';

/**
 * The dashboard's first real request after the server boots hits a cold
 * Supabase connection pool (TLS handshake + several queries), which can
 * comfortably exceed a normal per-assertion timeout even though every
 * later request is fast. Absorb that one-time cold start here, outside any
 * individual test's budget, instead of retrying/timing out inside the suite.
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

  await browser.close();
}
