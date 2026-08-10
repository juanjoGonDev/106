import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const applicationUrl = 'http://127.0.0.1:3000';
const token = 'b'.repeat(64);

function requestBody(route) {
  try {
    return route.request().postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installEntryMocks(page) {
  await page.route('**/functions/v1/zadmin-api', async (route) => {
    const body = requestBody(route);
    if (body.action === 'login') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }),
      });
      return;
    }
    if (body.action === 'overview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: 'account',
          rangeDays: 7,
          truncated: false,
          summary: {
            attempts: 0,
            verifiedAttempts: 0,
            watchAttempts: 0,
            excludedAttempts: 0,
            distinctAccounts: 0,
            distinctNicks: 0,
            distinctIps: 0,
            activeManualBans: 0,
          },
          entities: [],
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown action' }) });
  });
}

test('slashless /zadmin canonicalizes, loads its modules and submits Enter without URL credentials', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await installEntryMocks(page);

  await page.goto(`${applicationUrl}/zadmin`);
  expect(new URL(page.url()).pathname).toBe('/zadmin/');
  await expect(page.locator('#adminLoginPanel')).toBeVisible();
  await expect(page.locator('.zadmin-login-card')).toBeVisible();
  await expect(page.locator('.password-visibility-toggle')).toBeVisible();

  const card = await page.locator('.zadmin-login-card').boundingBox();
  const viewport = page.viewportSize();
  expect(card).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(card.width).toBeLessThanOrEqual(480.5);
  expect(Math.abs((card.x + card.width / 2) - viewport.width / 2)).toBeLessThanOrEqual(2);

  await page.locator('#adminUsername').fill('operator');
  await page.locator('#adminPassword').fill('strong-test-password');
  await page.locator('#adminPassword').press('Enter');

  await expect(page.locator('#adminDashboard')).toBeVisible();
  const currentUrl = new URL(page.url());
  expect(currentUrl.pathname).toBe('/zadmin/');
  expect(currentUrl.search).toBe('');
  expect(currentUrl.searchParams.has('username')).toBe(false);
  expect(currentUrl.searchParams.has('password')).toBe(false);
  expect(consoleErrors.filter((message) => /MIME type|Failed to load module script/i.test(message))).toEqual([]);
});
