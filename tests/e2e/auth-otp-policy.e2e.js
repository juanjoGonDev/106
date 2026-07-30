import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { openApplicationPage } from './app-navigation.js';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);

const applicationUrl = 'http://127.0.0.1:3000';
const previewDirectory = '.tmp/pr-previews';
const publishableKey = `sb_publishable_${'a'.repeat(32)}`;
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
mkdirSync(previewDirectory, { recursive: true });

function verifiedSession() {
  return {
    access_token: 'verified-access-token',
    refresh_token: 'verified-refresh-token',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'otp@example.com',
      email_confirmed_at: '2026-07-30T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      identities: [{ provider: 'email' }],
    },
  };
}

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function recordingContextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: {
      dir: join(previewDirectory, 'recordings'),
      size: isMobile ? { ...device.viewport } : { width: 1280, height: 800 },
    },
  };
}

async function installRuntime(page, authLog) {
  await page.route('**/config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({
      apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
      accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: publishableKey,
      authEmailOtpLength: 8,
      authEmailOtpExpirySeconds: 3600,
      turnstileSiteKey: '',
      publicSiteUrl: applicationUrl,
    })};`,
  }));

  await page.route('**/auth/v1/verify', async (route) => {
    authLog.push(requestBody(route.request()));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(verifiedSession()),
    });
  });

  await page.route('**/functions/v1/account-auth', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        linked: true,
        accountToken: 'b'.repeat(64),
        authReward: { granted: true, source: 'email_confirmation' },
      }),
    });
  });
}

async function installPendingEmail(page) {
  await page.addInitScript(() => {
    localStorage.setItem('minuto106:consent-v1', JSON.stringify({ analytics: false, ads: false }));
    localStorage.setItem('minuto106:pending-email-confirmation-v1', 'otp@example.com');
    localStorage.setItem('minuto106:email-resend-available-at-v1', '2000000000000');
  });
}

async function saveScreenshot(page, isMobile) {
  if (!captureEvidence) return;
  await page.screenshot({
    path: join(previewDirectory, `email-verification-${isMobile ? 'mobile' : 'desktop'}.png`),
    animations: 'disabled',
    fullPage: true,
  });
}

async function saveVideo(context, page, isMobile) {
  if (!captureEvidence) {
    await context.close();
    return;
  }
  const video = page.video();
  if (!video) throw new Error('Playwright did not create the email verification recording.');
  await context.close();
  await video.saveAs(join(previewDirectory, `email-verification-${isMobile ? 'mobile' : 'desktop'}.webm`));
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('email verification consumes the generated eight-digit OTP policy', async ({ browser, isMobile }) => {
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  const authLog = [];
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  await installRuntime(page, authLog);
  await installPendingEmail(page);
  await openApplicationPage(page, '/verificar-email.html');

  const otp = page.locator('#authOtp');
  const verify = page.locator('#verifyEmailCode');
  await expect(page.locator('#authLead')).toContainText('código de 8 dígitos');
  await expect(page.locator('#authLead')).toContainText('1 hora');
  await expect(page.locator('#otpHelp')).toContainText('exactamente 8 números');
  await expect(otp).toHaveAttribute('pattern', '[0-9]{8}');
  await expect(otp).toHaveAttribute('minlength', '8');
  await expect(otp).toHaveAttribute('maxlength', '8');
  await expect(otp).toHaveAttribute('placeholder', '00000000');

  await otp.fill('1234567');
  await expect(verify).toBeDisabled();
  await otp.fill('12a34567');
  await expect(otp).toHaveValue('1234567');
  await expect(verify).toBeDisabled();
  await otp.fill('12345678');
  await expect(verify).toBeEnabled();
  await assertNoHorizontalOverflow(page);
  await saveScreenshot(page, isMobile);
  await verify.click();

  await expect(page.locator('#verificationSuccess')).toBeVisible();
  await expect(page.locator('#verificationSuccessMessage')).toContainText('+1 intento diario');
  expect(authLog).toEqual([{ email: 'otp@example.com', token: '12345678', type: 'email' }]);
  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await saveVideo(context, page, isMobile);
});
