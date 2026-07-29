const { chromium } = require('playwright');

const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.fill('input[placeholder="you@company.com"]', 'admin@xavadigital.com');
  await page.fill('input[placeholder="Password"]', 'P@ssw0rd123!');
  await Promise.all([
    page.waitForURL(/\/admin/, { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(`${BASE}/admin/metrics`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('text=Production & Fulfillment', { timeout: 15000 });
  await page.setViewportSize({ width: 1280, height: 3200 });
  await page.screenshot({ path: 'metrics-full.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('=== NAV ORDER CHECK ===');
  const navText = await page.locator('.ant-menu').first().innerText();
  console.log(navText);

  console.log('=== METRICS PAGE CONTAINS ===');
  [
    'Average Order Value', 'Confirmation Rate', 'Avg. Time to Confirm',
    'Sales', 'Pipeline Value — Last 8 Weeks',
    'Conversion', 'Time to Confirm',
    'Customers', 'Top Clubs — by Order Count',
    'Production & Fulfillment', 'Purchase Order Status', 'Garment Type Popularity',
  ].forEach((t) => {
    console.log(t, '=>', bodyText.includes(t));
  });

  console.log('=== CONSOLE ERRORS ===');
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');

  await browser.close();
})().catch((err) => {
  console.error('SCRIPT FAILED:', err);
  process.exit(1);
});
