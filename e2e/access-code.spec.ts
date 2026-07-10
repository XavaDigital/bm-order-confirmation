import { test, expect } from '@playwright/test';
import { loginAsSeedAdmin, createDraftOrder, generateCustomerLink, uniqueSuffix } from './helpers';

test.describe('Access-code protected link', () => {
  test('a wrong code is rejected and the correct code reveals the order', async ({ page, context }) => {
    const suffix = uniqueSuffix();

    // 1. Staff creates an order, generates a link, and requires an access code.
    await loginAsSeedAdmin(page);
    await createDraftOrder(page, {
      customerName: `E2E Access Code ${suffix}`,
      customerEmail: `e2e-access-${suffix}@example.com`,
    });
    const customerUrl = await generateCustomerLink(page);

    await page.getByRole('switch').click();
    const codeText = await page.getByText(/^\d{6}$/).textContent();
    expect(codeText).toBeTruthy();
    const code = codeText!.trim();
    const wrongCode = code === '000000' ? '111111' : '000000';

    // 2. A visitor with the link but no code (or the wrong one) is gated out.
    const gatedContext = await context.browser()!.newContext();
    const gatedPage = await gatedContext.newPage();
    await gatedPage.goto(customerUrl);
    await expect(gatedPage.getByText('Access Code Required')).toBeVisible();

    const otpInputs = gatedPage.getByRole('textbox');
    await otpInputs.first().pressSequentially(wrongCode);
    await expect(gatedPage.getByText('Incorrect code. Please try again.')).toBeVisible();
    await expect(gatedPage.getByText('Access Code Required')).toBeVisible();
    await gatedContext.close();

    // 3. The correct code (fresh visitor session) reveals the order.
    const unlockedContext = await context.browser()!.newContext();
    const unlockedPage = await unlockedContext.newPage();
    await unlockedPage.goto(customerUrl);
    await unlockedPage.getByRole('textbox').first().pressSequentially(code);
    await expect(unlockedPage.getByRole('heading', { name: /oc-/i })).toBeVisible();
    await expect(unlockedPage.getByText('Access Code Required')).not.toBeVisible();
    await unlockedContext.close();
  });
});
