import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const publishableKey = `sb_publishable_${'a'.repeat(32)}`;
const accountToken = 'd'.repeat(64);
const baseUrl = 'http://127.0.0.1:3000';

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function authSession(provider = 'email', verified = true) {
  return {
    access_token: `${provider}-access-token`,
    refresh_token: `${provider}-refresh-token`,
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: `${provider}@example.com`,
      email_confirmed_at: verified ? '2026-07-27T00:00:00.000Z' : null,
      app_metadata: { provider },
    },
  };
}

async function installPage(page, options = {}) {
  const authLog = options.authLog || [];
  const accountLog = options.accountLog || [];
  const provider = options.provider || 'email';
  const reward = options.reward || {
    eligible: true,
    active: true,
    granted: false,
    dailyAttemptBonus: 1,
    source: provider === 'email' ? 'email_confirmation' : 'social_link',
    provider,
  };

  await page.route('**/config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({
        apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
        accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
        supabaseUrl: 'https://project.supabase.co',
        supabasePublishableKey: publishableKey,
        turnstileSiteKey: '',
        publicSiteUrl: baseUrl,
      })};`,
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    const payload = body.action === 'account-players'
      ? { exists: true, players: [{ nick: 'Activation106', attemptsLeft: 6, verifiedAttempts: 1 }] }
      : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.route('**/functions/v1/account-auth', async (route) => {
    const body = bodyOf(route.request());
    accountLog.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        linked: true,
        issueToken: false,
        auth: { provider, email: `${provider}@example.com`, emailVerified: true },
        authReward: reward,
      }),
    });
  });

  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = bodyOf(request);
    authLog.push({ path: url.pathname, search: url.search, method: request.method(), body });

    if (url.pathname.endsWith('/resend')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.pathname.endsWith('/authorize')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>OAuth provider</title>' });
      return;
    }
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'password') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authSession(provider)) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unexpected"}' });
  });

  await page.addInitScript(({ token, storedSession, pendingEmail }) => {
    localStorage.setItem('minuto106:account-access-v1', token);
    localStorage.setItem('minuto106:consent-v1', JSON.stringify({ analytics: false, ads: false }));
    if (storedSession) localStorage.setItem('minuto106:supabase-session-v1', JSON.stringify(storedSession));
    if (pendingEmail) localStorage.setItem('minuto106:pending-email-confirmation-v1', pendingEmail);
  }, {
    token: accountToken,
    storedSession: options.storedSession || null,
    pendingEmail: options.pendingEmail || '',
  });
}

test('pending email activation can be resent after reload and clearly expires after one hour', async ({ page }) => {
  const authLog = [];
  await installPage(page, { authLog, pendingEmail: 'pending@example.com' });
  await page.goto('/cuenta.html');

  const panel = page.locator('#cloudPendingPanel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('caducan en 1 hora');
  await expect(panel).toContainText('+1 intento diario');
  await expect(panel).toContainText('Cuenta confirmada');
  await expect(page.locator('#pendingConfirmationEmail')).toContainText('pending@example.com');
  await expect(page.locator('#cloudGuestPanel')).toBeHidden();
  await expect(page.locator('#cloudLocalLinkPanel')).toBeHidden();

  const resend = page.locator('#emailConfirmationResend');
  await expect(resend).toBeEnabled();
  await resend.click();

  await expect(page.locator('#cloudAccountStatus')).toContainText('válido durante 1 hora');
  await expect(page.locator('#emailConfirmationResendStatus')).toContainText('Podrás solicitar otro código');
  await expect(resend).toBeDisabled();
  expect(authLog.some((entry) => entry.path.endsWith('/resend')
    && entry.body.type === 'signup'
    && entry.body.email === 'pending@example.com')).toBe(true);
});

test('a signed-in Google account exposes no alternative social linking control', async ({ page }) => {
  const accountLog = [];
  await installPage(page, {
    provider: 'google',
    accountLog,
    storedSession: authSession('google'),
    reward: {
      eligible: true,
      active: true,
      granted: false,
      dailyAttemptBonus: 1,
      source: 'social_link',
      provider: 'google',
    },
  });
  await page.goto('/cuenta.html');

  await expect(page.locator('#cloudAccountIdentity')).toContainText('google@example.com');
  await expect(page.locator('#cloudAccountIdentity')).toContainText('Acceso: Google');
  await expect(page.locator('#cloudAccountStatus')).toContainText('por Google sigue activa');
  await expect(page.getByRole('button', { name: 'Google vinculado' })).toBeDisabled();
  await expect(page.locator('#cloudAuthenticatedPanel .oauth-button')).toHaveCount(1);
  expect(accountLog.some((entry) => entry.action === 'sync-account')).toBe(true);
});

test('Google-origin reward is granted once and has no email-confirmation achievement', async ({ page }) => {
  await installPage(page, {
    provider: 'google',
    storedSession: authSession('google'),
    reward: {
      eligible: true,
      active: true,
      granted: true,
      dailyAttemptBonus: 1,
      source: 'social_link',
      provider: 'google',
      achievementCode: null,
      achievementTitle: null,
      achievementsGranted: 0,
    },
  });
  await page.goto('/cuenta.html');

  await expect(page.locator('#cloudAccountStatus')).toContainText('vinculada con Google');
  await expect(page.locator('#cloudAccountStatus')).toContainText('Has recibido +1 intento diario');
  await expect(page.locator('#cloudPendingPanel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Google vinculado' })).toBeDisabled();
  await expect(page.locator('#cloudAuthenticatedPanel .oauth-button')).toHaveCount(1);
});
