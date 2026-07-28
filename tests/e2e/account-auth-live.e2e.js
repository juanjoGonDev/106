import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const appUrl = 'http://localhost:3000';
const supabaseUrl = String(process.env.SUPABASE_TEST_URL || '').replace(/\/$/u, '');
const anonKey = String(process.env.SUPABASE_TEST_ANON_KEY || '');
const serviceRoleKey = String(process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || '');
const databaseUrl = String(process.env.SUPABASE_TEST_DB_URL || '');
const liveEnabled = process.env.SUPABASE_AUTH_LIVE === '1'
  && Boolean(supabaseUrl && anonKey && serviceRoleKey && databaseUrl);
const hashPepper = 'ci-local-only-pepper-106-do-not-use-in-production';
const password = 'LiveAuthPassword123!';
const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const emailOrigin = {};
const socialOrigin = {};

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { encoding: 'utf8', cwd: process.cwd() });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function accountHash(token) {
  return createHash('sha256').update(`${hashPepper}:account:${token}`).digest('hex');
}

function accountId(token) {
  return psql(`select public.resolve_game_account_token(${sqlLiteral(accountHash(token))});`);
}

function authUserId(email) {
  return psql(`select id from auth.users where lower(email) = lower(${sqlLiteral(email)}) limit 1;`);
}

function oneTimeTokenTableExists() {
  return psql("select to_regclass('auth.one_time_tokens') is not null;") === 't';
}

function confirmationToken(email) {
  const userId = authUserId(email);
  if (!userId) return '';
  if (oneTimeTokenTableExists()) {
    const token = psql(`
      select token_hash
      from auth.one_time_tokens
      where user_id = ${sqlLiteral(userId)}::uuid
      order by created_at desc
      limit 1;
    `);
    if (token) return token;
  }
  return psql(`select confirmation_token from auth.users where id = ${sqlLiteral(userId)}::uuid;`);
}

function expireConfirmation(email) {
  const userId = authUserId(email);
  if (!userId) throw new Error(`Auth user not found for ${email}`);
  psql(`
    update auth.users
    set confirmation_sent_at = clock_timestamp() - interval '61 minutes'
    where id = ${sqlLiteral(userId)}::uuid;
  `);
  if (oneTimeTokenTableExists()) {
    psql(`
      update auth.one_time_tokens
      set created_at = clock_timestamp() - interval '61 minutes'
      where user_id = ${sqlLiteral(userId)}::uuid;
    `);
  }
}

function entitlementState(id) {
  return psql(`
    select count(*)::text || '|' || coalesce(max(metadata->>'source'), '')
    from public.game_account_entitlements
    where public.resolve_game_account_id(account_id) = ${sqlLiteral(id)}::uuid
      and entitlement_code = 'auth_identity_daily_attempt';
  `);
}

function achievementCount(nick) {
  return Number(psql(`
    select count(*)
    from public.game_player_achievements
    where nick_key = lower(${sqlLiteral(nick)})
      and achievement_code = 'email_verified';
  `));
}

function identityProviders(id) {
  return psql(`
    select coalesce(string_agg(provider, ',' order by provider), '')
    from public.game_auth_identities
    where public.resolve_game_account_id(account_id) = ${sqlLiteral(id)}::uuid;
  `);
}

function dailyAttemptState(nick) {
  return JSON.parse(psql(`
    select public.get_game_daily_attempt_state(
      lower(${sqlLiteral(nick)}),
      clock_timestamp()
    )::text;
  `));
}

function expectDailyState(nick, expectedBonus) {
  const state = dailyAttemptState(nick);
  expect(state.dailyLimitBase).toBe(5);
  expect(state.authRewardBonus).toBe(expectedBonus);
  expect(state.emailVerificationBonus).toBe(expectedBonus);
  expect(state.bonusAttempts).toBe(expectedBonus);
  expect(state.maxAttempts).toBe(5 + expectedBonus);
  expect(state.attemptsLeft).toBe(5 + expectedBonus);
  expect(state.dailyLimitCeiling).toBe(10);
}

function directVerifyUrl(token) {
  const url = new URL(`${supabaseUrl}/auth/v1/verify`);
  url.searchParams.set('token', token);
  url.searchParams.set('type', 'signup');
  url.searchParams.set('redirect_to', `${appUrl}/verificar-email.html`);
  return url.toString();
}

function applicationVerifyUrl(tokenHash) {
  const url = new URL(`${appUrl}/verificar-email.html`);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'email');
  return url.toString();
}

function adminHeaders() {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
}

function publicHeaders(accessToken = '') {
  const headers = { apikey: anonKey, 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return headers;
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

async function createProviderUser(request, provider, email) {
  const created = await request.post(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: adminHeaders(),
    data: {
      email,
      password,
      email_confirm: true,
      app_metadata: { provider, providers: [provider] },
    },
  });
  const body = await responseJson(created);
  expect(created.status(), JSON.stringify(body)).toBe(200);

  if (body.app_metadata?.provider !== provider) {
    const updated = await request.put(`${supabaseUrl}/auth/v1/admin/users/${body.id}`, {
      headers: adminHeaders(),
      data: { app_metadata: { provider, providers: [provider] } },
    });
    const updateBody = await responseJson(updated);
    expect(updated.status(), JSON.stringify(updateBody)).toBe(200);
  }
  return body;
}

async function signIn(request, email) {
  const response = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: publicHeaders(),
    data: { email, password },
  });
  const body = await responseJson(response);
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.access_token).toBeTruthy();
  expect(body.refresh_token).toBeTruthy();
  return body;
}

async function createAnonymousPlayer(request, token, nick) {
  const response = await request.post(`${supabaseUrl}/functions/v1/game-api`, {
    headers: {
      origin: appUrl,
      'content-type': 'application/json',
      'x-account-token': token,
      'x-device-id': `playwright-live-${suffix}-${nick}`.slice(0, 80),
    },
    data: { action: 'link-account-player', nick },
  });
  const body = await responseJson(response);
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.authorized).toBe(true);
}

async function openPage(browser, path, { session = null, accountToken = '', pendingEmail = '' } = {}) {
  const context = await browser.newContext({ baseURL: appUrl });
  await context.addInitScript(({ storedSession, token, email }) => {
    localStorage.setItem('minuto106:consent-v1', JSON.stringify({ analytics: false, ads: false }));
    if (storedSession) localStorage.setItem('minuto106:supabase-session-v1', JSON.stringify(storedSession));
    if (token) localStorage.setItem('minuto106:account-access-v1', token);
    if (email) localStorage.setItem('minuto106:pending-email-confirmation-v1', email);
  }, { storedSession: session, token: accountToken, email: pendingEmail });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${appUrl}/${path}`);
  return {
    context,
    page,
    assertNoErrors(allowedError = () => false) {
      expect(errors.filter((error) => !allowedError(error))).toEqual([]);
    },
  };
}

async function openAccount(browser, options = {}) {
  return openPage(browser, 'cuenta.html', options);
}

async function recoveredToken(page) {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('minuto106:account-access-v1') || ''))
    .toMatch(/^[a-f0-9]{64}$/u);
  return page.evaluate(() => localStorage.getItem('minuto106:account-access-v1'));
}

async function linkSession(browser, session, token, nick) {
  const opened = await openAccount(browser, { session, accountToken: token });
  await expect(opened.page.locator('#cloudAccountStatus')).toContainText('+1 intento diario');
  await expect(opened.page.locator('#accountPlayers')).toContainText(nick);
  opened.assertNoErrors();
  await opened.context.close();
}

async function assertProtectedRoute(browser, route, options) {
  const opened = await openPage(browser, route, options);
  await expect(opened.page).toHaveURL(/\/cuenta\.html$/u);
  opened.assertNoErrors();
  await opened.context.close();
}

test.describe('real Supabase account authentication @live-auth', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!liveEnabled, 'Requires the local Supabase stack and its ephemeral test credentials.');

  test('email registration, skip, nick creation, expiry, resend and verification raise the daily limit from five to six', async ({ browser, request }) => {
    const email = `email-origin-${suffix}@example.com`;
    const nick = `Email${suffix}`.slice(0, 24);
    const opened = await openPage(browser, 'registro.html');
    const { page } = opened;

    await expect(page.getByRole('heading', { name: 'Crear cuenta' })).toBeVisible();
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPassword').fill('Short1!');
    await page.locator('#authPasswordConfirmation').fill('Different1!');
    await expect(page.locator('#authSubmit')).toBeDisabled();
    await expect(page.locator('[data-requirement="length"]')).toHaveAttribute('data-met', 'false');
    await expect(page.locator('#authPasswordMatch')).toContainText('no coinciden');

    await page.locator('#authPassword').fill(password);
    await page.locator('#authPasswordConfirmation').fill(password);
    await expect(page.locator('#authSubmit')).toBeEnabled();
    await page.locator('#authSubmit').click();
    await expect(page).toHaveURL(/\/verificar-email\.html$/u);
    await expect(page.locator('#pendingConfirmationEmail')).toContainText(email);
    await expect(page.locator('.verification-prize')).toContainText('+1 intento diario');

    await page.getByRole('link', { name: 'Saltar por ahora e ir a Mi cuenta' }).click();
    await expect(page).toHaveURL(/\/cuenta\.html$/u);
    await expect(page.locator('#cloudPendingPanel')).toBeVisible();
    await page.locator('#accountNickInput').fill(nick);
    await expect(page.locator('#createAccountNick')).toBeEnabled();
    await page.locator('#createAccountNick').click();
    await expect(page.locator('#accountPlayers')).toContainText(nick);
    const token = await recoveredToken(page);
    const id = accountId(token);
    expect(id).toBeTruthy();
    expect(entitlementState(id)).toBe('0|');
    expect(achievementCount(nick)).toBe(0);
    expectDailyState(nick, 0);

    await page.goto(`${appUrl}/verificar-email.html`);
    await expect.poll(() => confirmationToken(email)).not.toBe('');
    const expiredToken = confirmationToken(email);
    expireConfirmation(email);
    const expired = await request.get(directVerifyUrl(expiredToken), { maxRedirects: 0 });
    const expiredLocation = expired.headers().location || '';
    expect(expired.status() >= 400 || /error/iu.test(expiredLocation)).toBe(true);

    await page.evaluate(() => localStorage.setItem('minuto106:email-resend-available-at-v1', '0'));
    await page.reload();
    const resendButton = page.locator('#emailConfirmationResend');
    await expect(resendButton).toBeEnabled();
    const resendResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/auth/v1/resend')
      && response.request().method() === 'POST'
    ));
    await resendButton.click();
    expect((await resendResponsePromise).ok()).toBe(true);
    await expect.poll(() => confirmationToken(email)).not.toBe(expiredToken);
    await expect(resendButton).toBeDisabled();
    await expect(page.locator('#emailConfirmationResendStatus')).toContainText('Podrás solicitar otro código en');

    const activeToken = confirmationToken(email);
    await page.goto(applicationVerifyUrl(activeToken));
    await expect(page.locator('#verificationSuccess')).toBeVisible();
    await expect(page.locator('#verificationSuccessMessage')).toContainText('Has recibido +1 intento diario');
    await expect(page.locator('#verificationSuccessMessage')).toContainText('Cuenta confirmada');
    expect(new URL(page.url()).searchParams.has('token_hash')).toBe(false);

    expect(entitlementState(id)).toBe('1|email_confirmation');
    expect(achievementCount(nick)).toBe(1);
    expectDailyState(nick, 1);

    const replay = await request.post(`${supabaseUrl}/auth/v1/verify`, {
      headers: publicHeaders(),
      data: { token_hash: activeToken, type: 'email' },
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    expect(entitlementState(id)).toBe('1|email_confirmation');
    expect(achievementCount(nick)).toBe(1);
    expectDailyState(nick, 1);

    emailOrigin.nick = nick;
    emailOrigin.token = token;
    emailOrigin.accountId = id;
    emailOrigin.session = await signIn(request, email);
    opened.assertNoErrors();
    await opened.context.close();

    await assertProtectedRoute(browser, 'login.html', { session: emailOrigin.session });
    await assertProtectedRoute(browser, 'registro.html', { accountToken: token });
  });

  test('Google then Facebook share one reward and recover the same nicks from clean browsers', async ({ browser, request }) => {
    const token = randomBytes(32).toString('hex');
    const nick = `Social${suffix}`.slice(0, 24);
    const googleEmail = `google-${suffix}@example.com`;
    const facebookEmail = `facebook-${suffix}@example.com`;
    await createAnonymousPlayer(request, token, nick);

    await createProviderUser(request, 'google', googleEmail);
    const googleSession = await signIn(request, googleEmail);
    expect(googleSession.user.app_metadata.provider).toBe('google');
    await linkSession(browser, googleSession, token, nick);
    const id = accountId(token);
    expect(entitlementState(id)).toBe('1|social_link');
    expectDailyState(nick, 1);

    await createProviderUser(request, 'facebook', facebookEmail);
    const facebookSession = await signIn(request, facebookEmail);
    expect(facebookSession.user.app_metadata.provider).toBe('facebook');
    await linkSession(browser, facebookSession, token, nick);
    expect(entitlementState(id)).toBe('1|social_link');
    expect(identityProviders(id)).toBe('facebook,google');
    expect(achievementCount(nick)).toBe(0);
    expectDailyState(nick, 1);

    const recoveredIds = [];
    for (const session of [googleSession, facebookSession]) {
      const clean = await openAccount(browser, { session });
      await expect(clean.page.locator('#accountPlayers')).toContainText(nick);
      recoveredIds.push(accountId(await recoveredToken(clean.page)));
      clean.assertNoErrors();
      await clean.context.close();
    }
    expect(recoveredIds).toEqual([id, id]);

    socialOrigin.googleSession = googleSession;
  });

  test('an email-origin account can add both social providers without stacking its daily reward', async ({ browser, request }) => {
    expect(emailOrigin.accountId).toBeTruthy();
    const googleEmail = `email-google-${suffix}@example.com`;
    const facebookEmail = `email-facebook-${suffix}@example.com`;
    await createProviderUser(request, 'google', googleEmail);
    await createProviderUser(request, 'facebook', facebookEmail);

    const googleSession = await signIn(request, googleEmail);
    const facebookSession = await signIn(request, facebookEmail);
    await linkSession(browser, googleSession, emailOrigin.token, emailOrigin.nick);
    await linkSession(browser, facebookSession, emailOrigin.token, emailOrigin.nick);

    expect(entitlementState(emailOrigin.accountId)).toBe('1|email_confirmation');
    expect(achievementCount(emailOrigin.nick)).toBe(1);
    expect(identityProviders(emailOrigin.accountId)).toBe('email,facebook,google');
    expectDailyState(emailOrigin.nick, 1);
  });

  test('anon and authenticated browser requests cannot access private tables or privileged RPCs', async ({ browser }) => {
    expect(socialOrigin.googleSession?.access_token).toBeTruthy();
    const opened = await openAccount(browser, { session: socialOrigin.googleSession });
    const statuses = await opened.page.evaluate(async ({ url, key, accessToken }) => {
      async function probe(path, authorization, options = {}) {
        const headers = { apikey: key, ...(options.headers || {}) };
        if (authorization) headers.authorization = `Bearer ${authorization}`;
        const response = await fetch(`${url}${path}`, { ...options, headers });
        return response.status;
      }

      const results = [];
      for (const authorization of ['', accessToken]) {
        results.push(await probe('/rest/v1/game_accounts?select=id', authorization));
        results.push(await probe('/rest/v1/game_auth_identities?select=auth_user_id', authorization));
        results.push(await probe('/rest/v1/rpc/grant_game_auth_link_reward', authorization, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ p_auth_user_id: '11111111-1111-4111-8111-111111111111' }),
        }));
      }
      return results;
    }, { url: supabaseUrl, key: anonKey, accessToken: socialOrigin.googleSession.access_token });

    expect(statuses).toHaveLength(6);
    for (const status of statuses) expect([401, 403, 404]).toContain(status);
    opened.assertNoErrors((error) => /Failed to load resource: the server responded with a status of (401|403|404)/u.test(error));
    await opened.context.close();
  });
});