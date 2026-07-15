import { test, expect } from '@playwright/test';
import {
  createDraftOrder,
  generateCustomerLink,
  checkAllAcknowledgments,
  uniqueSuffix,
} from './helpers';

test.describe('Changes requested', () => {
  test('customer requests changes, staff edits and resends the link, customer re-confirms', async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const comment = `E2E please make it bigger ${suffix}`;

    // 1. Staff (already logged in via storageState) creates and shares an order.
    await createDraftOrder(page, {
      customerName: `E2E Changes ${suffix}`,
      customerEmail: `e2e-changes-${suffix}@example.com`,
    });
    const firstUrl = await generateCustomerLink(page);

    // 2. Customer requests changes instead of confirming.
    const customerContext = await context.browser()!.newContext();
    const customerPage = await customerContext.newPage();
    await customerPage.goto(firstUrl);
    await customerPage.getByRole('button', { name: /request changes/i }).click();
    const dialog = customerPage.getByRole('dialog');
    await dialog.getByPlaceholder(/the sizing for jersey/i).fill(comment);
    await dialog.getByRole('button', { name: /submit request/i }).click();
    await expect(customerPage.getByText('Changes Requested', { exact: true })).toBeVisible();
    await customerContext.close();

    // 3. Staff sees the comment and status, edits the order, and resends a fresh link.
    await page.reload();
    await expect(page.getByText('Changes Requested', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(comment)).toBeVisible();

    await page.getByRole('tab', { name: 'Details' }).click();
    await page.getByPlaceholder('Westside FC').fill(`E2E Club ${suffix}`);
    await page.getByRole('button', { name: /save details/i }).click();
    await expect(page.getByText('Order details saved')).toBeVisible();

    const secondUrl = await generateCustomerLink(page);
    expect(secondUrl).not.toBe(firstUrl);

    // 4. Customer opens the fresh link and confirms this time.
    const secondCustomerContext = await context.browser()!.newContext();
    const secondCustomerPage = await secondCustomerContext.newPage();
    await secondCustomerPage.goto(secondUrl);
    await checkAllAcknowledgments(secondCustomerPage);
    await secondCustomerPage.getByRole('button', { name: /confirm order/i }).click();
    await secondCustomerPage.getByRole('button', { name: /yes, confirm/i }).click();
    await expect(secondCustomerPage.getByText('Confirmed', { exact: true })).toBeVisible();
    await secondCustomerContext.close();

    // 5. Staff sees the order as confirmed.
    await page.reload();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  });
});
