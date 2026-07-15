import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** The seed admin from .env.local (SEED_ADMIN_*) — no 2FA enabled. */
export const SEED_ADMIN = {
  email: 'admin@xavadigital.com',
  password: 'P@ssw0rd123!',
};

/** Prefix every piece of e2e-created data with this so it's identifiable in the dev DB. */
export const E2E_TAG = 'e2e';

/**
 * Where globalSetup saves the seed admin's logged-in cookie so most specs can
 * start already authenticated instead of calling loginAsSeedAdmin() themselves.
 * The login rate limiter (10 attempts/15min/IP, src/lib/rate-limit.ts) is real
 * and un-mocked here — with 5+ spec files each doing their own fresh login,
 * the suite was landing right at that ceiling. auth.spec.ts still needs (and
 * gets) real fresh logins since it tests the login flow itself; see its
 * `test.use({ storageState: ... })` override.
 */
export const STORAGE_STATE_PATH = './e2e/.auth/admin-storage-state.json';

export function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

export async function loginAsSeedAdmin(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(SEED_ADMIN.email);
  await page.getByPlaceholder('Password').fill(SEED_ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

export async function logout(page: Page) {
  // The user menu trigger sits at the bottom of the sidebar and shows the
  // staff member's own name (not a fixed label), so click the stable user
  // icon inside it rather than matching on name text. dispatchEvent bypasses
  // hit-testing because Next's dev-mode overlay badge sits in that same
  // corner of the viewport and would otherwise intercept a real click there.
  await page.locator('.ant-layout-sider .anticon-user').dispatchEvent('click');
  await page.getByText('Sign out').click();
  await expect(page).toHaveURL(/\/login/);
}

/** Fills the New Order form with one garment and submits it. Leaves the page on the order detail view. */
export async function createDraftOrder(
  page: Page,
  opts: { customerName: string; customerEmail: string; garmentName?: string },
) {
  await page.goto('/admin/orders/new');
  await page.getByPlaceholder('Jane Smith').fill(opts.customerName);
  await page.getByPlaceholder('jane@teamclub.co.nz').fill(opts.customerEmail);
  await page.getByPlaceholder('Garment name (e.g. Home Jersey)').fill(opts.garmentName ?? 'E2E Test Jersey');
  await page.getByRole('button', { name: /create order/i }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]+$/);
}

/**
 * From an order detail page, opens the Share Link tab and generates a fresh
 * customer link. `createOrder` (used by both the New Order form and the
 * external `/api/orders` integration point) always creates an initial
 * access token, so the button already reads "Regenerate link" rather than
 * "Generate link" from the very first visit — match either.
 */
export async function generateCustomerLink(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.getByRole('tab', { name: 'Share Link' }).click();
  // Accessible name includes the icon's own label (e.g. "reload Regenerate link"), so match loosely.
  await page.getByRole('button', { name: /generate link/i }).click();
  const urlText = await page.getByText(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/o/`)).textContent();
  expect(urlText).toBeTruthy();
  return urlText!.trim();
}

/**
 * From an order detail page, opens the Team Roster tab and generates a fresh
 * shared roster link. Mirrors `generateCustomerLink` above but for the
 * `/o/roster/[rosterToken]` shared link rather than the `/o/[token]` one.
 */
export async function generateRosterLink(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.getByRole('tab', { name: 'Team Roster' }).click();
  // Accessible name includes the icon's own label, and reads "Regenerate link"
  // after the first link exists — match either, same as generateCustomerLink.
  await page.getByRole('button', { name: /generate link/i }).click();
  const urlText = await page
    .getByText(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/o/roster/`))
    .textContent();
  expect(urlText).toBeTruthy();
  return urlText!.trim();
}

export async function checkAllAcknowledgments(page: Page) {
  const checkboxes = page.getByRole('checkbox');
  const count = await checkboxes.count();
  expect(count).toBe(7);
  for (let i = 0; i < count; i++) {
    await checkboxes.nth(i).check();
  }
}
