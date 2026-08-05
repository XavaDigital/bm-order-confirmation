import { test, expect } from '@playwright/test';
import {
  createDraftOrder,
  generateCustomerLink,
  checkAllAcknowledgments,
  uniqueSuffix,
} from './helpers';

test.describe('Changes requested', () => {
  test('customer requests changes, staff edits the order, and the customer re-confirms on the same link', async ({
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
    const customerUrl = await generateCustomerLink(page);

    // 2. Customer requests changes instead of confirming.
    const customerContext = await context.browser()!.newContext();
    const customerPage = await customerContext.newPage();
    await customerPage.goto(customerUrl);
    await customerPage.getByRole('button', { name: /request changes/i }).click();
    const dialog = customerPage.getByRole('dialog');
    await dialog.getByPlaceholder(/the sizing for jersey/i).fill(comment);
    await dialog.getByRole('button', { name: /submit request/i }).click();
    await expect(customerPage.getByText('Changes Requested', { exact: true })).toBeVisible();
    await customerContext.close();

    // 3. Staff sees the status and, on the Details tab, the comment — that
    // alert lives inside the Details section's own children (OrderDetailView
    // renders one section's content at a time via its Menu nav), and reload
    // leaves the page on whatever tab generateCustomerLink() last opened
    // (?tab=share), so switch to Details before asserting the comment is
    // there. The link itself is never revoked by a changes-requested cycle
    // (requestOrderChanges() only flips the order status — customer-service.ts)
    // and ShareLinkPanel has no Regenerate action any more (David, 2026-08-04),
    // so the same link is reused below rather than minting a second one.
    await page.reload();
    await expect(page.getByText('Changes Requested', { exact: true }).first()).toBeVisible();
    await page.getByRole('menuitem', { name: 'Details' }).click();
    await expect(page.getByText(comment)).toBeVisible();

    // Contact & branding fields (including club name) moved out of the
    // Details form onto the Team order page tab (OrderContactPanel.tsx,
    // David 2026-08-04) — Details' own OrderForm renders with
    // hideContactFields, so "Westside FC" only exists over there.
    await page.getByRole('menuitem', { name: 'Team order page' }).click();
    await page.getByPlaceholder('Westside FC').fill(`E2E Club ${suffix}`);
    await page.getByRole('button', { name: /save contact details/i }).click();
    await expect(page.getByText('Contact details saved')).toBeVisible();

    // 4. Customer reopens the SAME link. order.status is still
    // 'changes_requested', not 'confirmed' — view.tsx only special-cases
    // 'confirmed' server-side, so the normal confirm form renders again (the
    // "Changes Requested" panel above was local post-submit state, not
    // something persisted into the page on reload).
    const secondCustomerContext = await context.browser()!.newContext();
    const secondCustomerPage = await secondCustomerContext.newPage();
    await secondCustomerPage.goto(customerUrl);
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
