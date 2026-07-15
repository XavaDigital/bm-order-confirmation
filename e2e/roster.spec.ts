import { test, expect } from '@playwright/test';
import { createDraftOrder, generateRosterLink, uniqueSuffix } from './helpers';

test.describe('Team roster', () => {
  test('a team member self-adds via the shared roster link, submits a size, and staff locks the roster', async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const memberName = `E2E Roster Member ${suffix}`;

    // 1. Staff (already logged in via storageState) creates an order and
    // generates a shared roster link.
    await createDraftOrder(page, {
      customerName: `E2E Roster ${suffix}`,
      customerEmail: `e2e-roster-${suffix}@example.com`,
    });
    const rosterUrl = await generateRosterLink(page);

    // 2. A team member opens the link in a separate browsing context (no staff
    // session), adds themselves to the empty roster, and submits their size.
    const memberContext = await context.browser()!.newContext();
    const memberPage = await memberContext.newPage();
    await memberPage.goto(rosterUrl);
    await expect(memberPage.getByText('No team members have been added yet.')).toBeVisible();

    await memberPage.getByPlaceholder('Your name').fill(memberName);
    await memberPage.getByPlaceholder('Player number (optional)').fill('11');
    await memberPage.getByRole('button', { name: /add me to the roster/i }).click();
    await expect(memberPage.getByRole('button', { name: new RegExp(memberName) })).toBeVisible();

    await memberPage.getByPlaceholder(/enter your size/i).fill('L');
    await memberPage.getByRole('button', { name: /save my sizes/i }).click();
    await expect(
      memberPage.getByText('You have already submitted sizes for this roster.'),
    ).toBeVisible();
    await memberContext.close();

    // 3. Staff reloads the Team Roster tab, sees the submission, and locks the roster.
    await page.reload();
    await page.getByRole('tab', { name: 'Team Roster' }).click();
    await expect(page.getByText('1 of 1 submitted')).toBeVisible();
    const memberRow = page.getByRole('row').filter({ hasText: memberName });
    await expect(memberRow).toContainText('Submitted');

    await page.getByRole('switch').click();
    await expect(page.getByText('Roster locked')).toBeVisible();

    // 4. A locked roster blocks the team member from changing their size.
    const lateContext = await context.browser()!.newContext();
    const latePage = await lateContext.newPage();
    await latePage.goto(rosterUrl);
    await expect(latePage.getByText('This roster is locked')).toBeVisible();
    await expect(latePage.getByRole('button', { name: /update my sizes/i })).toBeDisabled();
    await lateContext.close();
  });
});
