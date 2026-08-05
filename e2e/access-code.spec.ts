import { test, expect } from '@playwright/test';
import { createDraftOrder, generateCustomerLink, uniqueSuffix } from './helpers';

test.describe('Access-code protected link', () => {
  test('a wrong code is rejected and the correct code reveals the order', async ({ page, context }) => {
    const suffix = uniqueSuffix();

    // 1. Staff (already logged in via storageState) creates an order and
    // generates a link. `createOrder` mints the token at creation time, so
    // ShareLinkPanel's auto-generate-on-mount effect (David, 2026-08-04) is a
    // no-op here — activeUrl is already populated from the initialUrl prop,
    // which also means the code-auto-enable logic nested inside that effect
    // never runs. Requiring a code is still an explicit switch toggle.
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
    // AccessCodeGate.tsx is a single Input.Search (aria-label "Access code"),
    // not per-character OTP boxes — codes may be words as well as digits
    // (David, 2026-08-03).
    const gatedContext = await context.browser()!.newContext();
    const gatedPage = await gatedContext.newPage();
    await gatedPage.goto(customerUrl);
    await expect(gatedPage.getByText('Access Code Required')).toBeVisible();

    await gatedPage.getByLabel('Access code').fill(wrongCode);
    await gatedPage.getByRole('button', { name: /view order/i }).click();
    await expect(gatedPage.getByText('Incorrect code. Please try again.')).toBeVisible();
    await expect(gatedPage.getByText('Access Code Required')).toBeVisible();
    await gatedContext.close();

    // 3. The correct code (fresh visitor session) reveals the order.
    const unlockedContext = await context.browser()!.newContext();
    const unlockedPage = await unlockedContext.newPage();
    await unlockedPage.goto(customerUrl);
    await unlockedPage.getByLabel('Access code').fill(code);
    await unlockedPage.getByRole('button', { name: /view order/i }).click();
    await expect(unlockedPage.getByRole('heading', { name: /oc-/i })).toBeVisible();
    await expect(unlockedPage.getByText('Access Code Required')).not.toBeVisible();
    await unlockedContext.close();
  });
});
