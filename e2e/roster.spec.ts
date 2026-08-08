import { test, expect } from '@playwright/test';
import {
  createDraftOrder,
  enableTeamOrderPage,
  orderIdFromUrl,
  uniqueSuffix,
} from './helpers';
import { seedSizeChartForOrder } from './db';

/**
 * The team order page, re-written 2026-08-08.
 *
 * The previous version was written before the 2026-08-04 redesign and nothing
 * ran it afterwards (these specs only reached CI on 2026-08-08), so it had
 * drifted four ways: the address moved from /o/roster/<token> to
 * /team/<order-number>; the "Generate link" button was removed; the member flow
 * gained an entry gate; and picking a size became a dropdown fed by the
 * garment's linked size charts instead of a free-text field. All four are
 * covered below.
 *
 * The lock step goes through the API rather than the screen because the
 * redesign removed the lock control from the admin UI — the endpoint is still
 * there and still enforces, and a member being turned away is worth asserting
 * even with no button to press.
 */
test.describe('Team order page', () => {
  test('a team member joins through the team page, submits a size, and a locked roster turns them away', async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const memberName = `E2E Roster Member ${suffix}`;
    const memberEmail = `e2e-member-${suffix}@example.com`;

    // 1. Staff (already signed in via storageState) create the order. The size
    // chart is seeded directly: the only route that creates one requires a file
    // upload, which requires object storage, which CI has none of.
    await createDraftOrder(page, {
      customerName: `E2E Roster ${suffix}`,
      customerEmail: `e2e-roster-${suffix}@example.com`,
    });
    const orderId = orderIdFromUrl(page);
    const sizes = await seedSizeChartForOrder(orderId, `E2E Chart ${suffix}`);
    await page.reload();

    const { url, password } = await enableTeamOrderPage(page);
    expect(url).toContain('/team/');

    // 2. A team member opens the page in a clean browsing context — no staff
    // session — and gets past the gate with the password staff would send them.
    const memberContext = await context.browser()!.newContext();
    const memberPage = await memberContext.newPage();
    await memberPage.goto(url);

    await memberPage.getByPlaceholder('Team password').fill(password);
    await memberPage.getByPlaceholder('Your email').fill(memberEmail);
    await memberPage.getByPlaceholder('Your name (optional)').fill(memberName);
    await memberPage.getByRole('button', { name: 'Continue' }).click();

    // 3. They add themselves and pick a size from the chart.
    await memberPage.getByPlaceholder('Player name').fill(memberName);
    await memberPage.getByText('Pick a size').click();
    await memberPage.locator('.ant-select-item-option').filter({ hasText: sizes[1] }).first().click();
    await memberPage.getByRole('button', { name: /add player/i }).click();

    await expect(memberPage.getByText(memberName).first()).toBeVisible();
    await memberContext.close();

    // 4. Staff see the submission counted on the order.
    await page.reload();
    await page.getByRole('menuitem', { name: 'Team order page' }).click();
    await expect(page.getByText(/1 of 1 submitted/)).toBeVisible();

    // 5. Locking turns a returning member away. The control is gone from the
    // screen; the endpoint is not, and it is what actually protects the roster
    // once sizes are final.
    const lock = await page.request.post(`/api/admin/orders/${orderId}/roster/lock`);
    expect(lock.ok(), 'locking the roster should succeed').toBe(true);

    const lateContext = await context.browser()!.newContext();
    const latePage = await lateContext.newPage();
    await latePage.goto(url);
    await latePage.getByPlaceholder('Team password').fill(password);
    await latePage.getByPlaceholder('Your email').fill(memberEmail);
    await latePage.getByRole('button', { name: 'Continue' }).click();

    await expect(latePage.getByText(/locked/i).first()).toBeVisible();
    await lateContext.close();
  });
});
