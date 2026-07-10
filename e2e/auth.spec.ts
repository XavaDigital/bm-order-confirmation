import { test, expect } from '@playwright/test';
import { generateSync } from 'otplib';
import { loginAsSeedAdmin, logout, SEED_ADMIN, uniqueSuffix } from './helpers';

test.describe('Auth', () => {
  test('logging in with the wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(SEED_ADMIN.email);
    await page.getByPlaceholder('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logging in redirects to the dashboard, and logging out clears the session', async ({ page }) => {
    await loginAsSeedAdmin(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await logout(page);

    // Session is gone — a protected route bounces back to /login.
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a 2FA-enabled account is challenged with a TOTP code before reaching the dashboard', async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const email = `e2e-2fa-${suffix}@example.com`;
    const password = 'Correct-Horse-9!';

    // 1. Admin invites a new staff member. SMTP is disabled for this test
    // server, so the invite modal shows a setup link instead of emailing it.
    await loginAsSeedAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: /invite user/i }).click();
    const inviteDialog = page.getByRole('dialog');
    await inviteDialog.getByPlaceholder('Jane Smith').fill(`E2E 2FA ${suffix}`);
    await inviteDialog.getByPlaceholder('jane@example.com').fill(email);
    await inviteDialog.getByRole('button', { name: /send invite/i }).click();

    const setupUrlText = await page.locator('code').filter({ hasText: '/accept-invite' }).textContent();
    expect(setupUrlText).toBeTruthy();

    // From here on, act as the invited user in a separate browser context —
    // the admin's session cookie is still live on `page`, and landing on
    // /login while already authenticated as someone else just bounces
    // straight back to their dashboard.
    const userContext = await context.browser()!.newContext();
    const userPage = await userContext.newPage();

    // 2. Accept the invite as the new user and set a password.
    await userPage.goto(setupUrlText!);
    await userPage.getByPlaceholder('Min 8 characters').fill(password);
    await userPage.getByPlaceholder('Repeat password').fill(password);
    await userPage.getByRole('button', { name: /activate account/i }).click();
    await expect(userPage).toHaveURL(/\/login/);

    // 3. Log in as the new user and enable 2FA from their profile.
    await userPage.getByPlaceholder('Email').fill(email);
    await userPage.getByPlaceholder('Password').fill(password);
    await userPage.getByRole('button', { name: /sign in/i }).click();
    await expect(userPage).toHaveURL(/\/admin\/dashboard/);

    await userPage.goto('/admin/profile');
    await userPage.getByPlaceholder('Current password').fill(password);
    await userPage.getByRole('button', { name: /set up two-factor authentication/i }).click();

    const secret = await userPage.locator('code').first().textContent();
    expect(secret).toBeTruthy();
    const setupCode = generateSync({ secret: secret!.trim() });
    await userPage.getByPlaceholder('000000').fill(setupCode);
    await userPage.getByRole('button', { name: /verify & enable/i }).click();
    await expect(userPage.getByText(/two-factor authentication enabled/i)).toBeVisible();

    // 4. Log out and back in — this time it should stop at the 2FA challenge.
    await logout(userPage);
    await userPage.getByPlaceholder('Email').fill(email);
    await userPage.getByPlaceholder('Password').fill(password);
    await userPage.getByRole('button', { name: /sign in/i }).click();
    await expect(userPage).toHaveURL(/\/login\/2fa/);

    const loginCode = generateSync({ secret: secret!.trim() });
    await userPage.getByPlaceholder('000000').fill(loginCode);
    await userPage.getByRole('button', { name: /verify/i }).click();
    await expect(userPage).toHaveURL(/\/admin\/dashboard/);

    await userContext.close();
  });
});
