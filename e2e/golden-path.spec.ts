import { test, expect } from '@playwright/test';
import {
  loginAsSeedAdmin,
  createDraftOrder,
  generateCustomerLink,
  checkAllAcknowledgments,
  uniqueSuffix,
} from './helpers';

test.describe('Golden path', () => {
  test('staff creates an order, customer confirms it, staff sees the confirmed status and can download the PDF', async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();

    // 1. Staff creates a draft order with one garment and generates a link.
    await loginAsSeedAdmin(page);
    await createDraftOrder(page, {
      customerName: `E2E Golden ${suffix}`,
      customerEmail: `e2e-golden-${suffix}@example.com`,
    });
    const customerUrl = await generateCustomerLink(page);

    // 2. Customer opens the link in a separate browsing context (no staff session).
    const customerPage = await context.browser()!.newContext().then((c) => c.newPage());
    await customerPage.goto(customerUrl);
    await expect(customerPage.getByRole('heading', { name: /oc-/i })).toBeVisible();

    await checkAllAcknowledgments(customerPage);
    await customerPage.getByRole('button', { name: /confirm order/i }).click();
    await customerPage.getByRole('button', { name: /yes, confirm/i }).click();
    await expect(customerPage.getByText('Confirmed', { exact: true })).toBeVisible();
    await customerPage.context().close();

    // 3. Staff reloads and sees the confirmed status plus a working PDF download.
    await page.reload();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /download pdf/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });
});
