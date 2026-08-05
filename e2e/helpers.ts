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
  // Placeholder text, not the field label (LoginForm.tsx) — getByPlaceholder
  // matches the `placeholder` attribute, which reads "you@company.com".
  await page.getByPlaceholder('you@company.com').fill(SEED_ADMIN.email);
  await page.getByPlaceholder('Password').fill(SEED_ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

export async function logout(page: Page) {
  // The user menu (UserMenu.tsx) lives in the top Header, not the sidebar —
  // its trigger carries an explicit aria-label, so use that instead of a
  // CSS-class/icon guess.
  await page.getByRole('button', { name: 'Account menu' }).click();
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
 * From an order detail page, opens the Confirmation Link tab and reads the
 * customer link. `createOrder` mints the token at order-creation time, so it
 * is already present by the time this tab is opened — there is no button to
 * click, and Regenerate/Revoke were removed entirely (David, 2026-08-04:
 * "with the URL always visible there is nothing to re-surface"). Wait for it
 * explicitly rather than relying on the default action timeout.
 */
export async function generateCustomerLink(page: Page) {
  const origin = new URL(page.url()).origin;
  // OrderDetailView's section nav is an antd Menu (role="menuitem"), not Tabs.
  await page.getByRole('menuitem', { name: 'Confirmation Link' }).click();
  const urlLocator = page.getByText(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/o/`));
  await urlLocator.waitFor({ timeout: 15_000 });
  const urlText = await urlLocator.textContent();
  expect(urlText).toBeTruthy();
  return urlText!.trim();
}

/**
 * From an order detail page, opens the Team order page tab and generates a
 * fresh shared roster link. Mirrors `generateCustomerLink` above but for the
 * `/o/roster/[rosterToken]` shared link rather than the `/o/[token]` one.
 */
export async function generateRosterLink(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.getByRole('menuitem', { name: 'Team order page' }).click();
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
  // The acknowledgment set is admin-editable (AcknowledgmentPanel.tsx), not a
  // fixed list — assert there's at least one rather than an exact count that
  // drifts whenever the admin-configured set changes.
  const checkboxes = page.getByRole('checkbox');
  const count = await checkboxes.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await checkboxes.nth(i).check();
  }
}
