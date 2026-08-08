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
 * Locking goes through the screen again: the redesign had removed that control
 * — the endpoint enforced all along but nothing called it — and it was put back
 * on 2026-08-08, which this covers.
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
    //
    // Scoped to what is VISIBLE: the member panel renders more than once (the
    // page has responsive variants), so a plain placeholder match is ambiguous
    // and Playwright refuses it rather than guessing.
    await memberPage.locator('input[placeholder="Player name"]:visible').first().fill(memberName);
    await memberPage.locator('.ant-select-selector:visible').first().click();
    await memberPage
      .locator('.ant-select-item-option:visible')
      .filter({ hasText: sizes[1] })
      .first()
      .click();
    await memberPage
      .getByRole('button', { name: /add player/i })
      .and(memberPage.locator(':visible'))
      .first()
      .click();

    await expect(memberPage.getByText(memberName).first()).toBeVisible();
    await memberContext.close();

    // 4. Staff see the submission counted on the order.
    await page.reload();
    await page.getByRole('menuitem', { name: 'Team order page' }).click();
    await expect(page.getByText(/1 of 1 submitted/)).toBeVisible();

    // 5. Staff lock the roster from the screen, and it turns a returning member
    // away. The control was missing between the 2026-08-04 redesign and
    // 2026-08-08 — the endpoint enforced all along, but nothing called it.
    await page.getByRole('button', { name: /lock roster/i }).click();
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByText('Roster locked')).toBeVisible();

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
