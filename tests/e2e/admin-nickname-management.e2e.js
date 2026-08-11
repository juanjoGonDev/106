import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);

const applicationUrl = 'http://127.0.0.1:3000';
const previewDirectory = '.tmp/pr-previews';
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
const adminSessionToken = 'b'.repeat(64);
const accountToken = 'c'.repeat(64);
const playerId = '10600000-0000-4000-8000-000000000074';
const accountId = '10600000-0000-4000-8000-000000000075';
const temporaryNick = 'Jugador-10674abcdeff';

mkdirSync(previewDirectory, { recursive: true });

function contextOptions(isMobile, { account = false } = {}) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const localStorage = [{
    name: 'minuto106:consent-v1',
    value: JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-08-11T12:00:00.000Z' }),
  }];
  if (account) localStorage.push({ name: 'minuto106:account-access-v1', value: accountToken });
  const options = {
    ...device,
    baseURL: applicationUrl,
    storageState: {
      cookies: [],
      origins: [{ origin: applicationUrl, localStorage }],
    },
  };
  if (captureEvidence) {
    const videoSize = isMobile ? { ...device.viewport } : { width: 1280, height: 800 };
    options.recordVideo = { dir: join(previewDirectory, 'recordings'), size: videoSize };
  }
  return options;
}

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function stats() {
  return {
    targetMs: 10600,
    totalAttempts: 3,
    totalPlayers: 1,
    verifiedAttempts: 3,
    perfectAttempts: 0,
    teams: [{ team: 'spain', score: 1200 }, { team: 'argentina', score: 900 }],
    leaderboard: [],
    awards: {},
    honoursRankings: { trophies: [], achievements: [] },
  };
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

function collectRuntimeFailures(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  return { pageErrors, consoleErrors, failedRequests };
}

async function saveEvidence(page, video, evidenceId, isMobile) {
  if (!captureEvidence) return;
  const suffix = isMobile ? 'mobile' : 'desktop';
  await page.screenshot({
    path: join(previewDirectory, `${evidenceId}-${suffix}.png`),
    animations: 'disabled',
    fullPage: true,
  });
  if (!video) throw new Error(`Playwright did not create the ${evidenceId} recording.`);
}

async function saveVideo(video, evidenceId, isMobile) {
  if (!captureEvidence) return;
  const suffix = isMobile ? 'mobile' : 'desktop';
  await video.saveAs(join(previewDirectory, `${evidenceId}-${suffix}.webm`));
}

async function installZadminManagementMock(page, actions) {
  const restrictions = [
    {
      id: 74,
      source: 'integrity',
      status: 'active',
      scope: 'account',
      target: accountId,
      relatedNicks: ['JugadorPrueba'],
      triggered_at: '2026-08-11T11:20:00.000Z',
      expires_at: '2026-08-12T11:20:00.000Z',
      reason: 'Patrón automatizado detectado por policy v3',
      policy_version: 3,
      source_attempt_id: '10600000-0000-4000-8000-000000000076',
      evidence: {
        detector: 'ranked-integrity-v3',
        repeatedNearPerfect: 4,
        deviceCorrelation: true,
      },
      adminAction: null,
    },
    {
      id: 75,
      source: 'manual',
      status: 'active',
      scope: 'nick',
      target: 'jugadorprueba',
      relatedNicks: ['JugadorPrueba'],
      triggered_at: '2026-08-11T12:10:00.000Z',
      expires_at: null,
      reason: 'Revisión manual pendiente',
      adminAction: null,
    },
  ];
  const players = [{
    playerId,
    nick: 'JugadorPrueba',
    nickKey: 'jugadorprueba',
    accountId,
    linkedAt: '2026-08-09T08:30:00.000Z',
    verifiedEmailAvailable: true,
    renameRequired: false,
    renameRequirement: null,
  }];

  await page.route('**/functions/v1/zadmin-management', async (route) => {
    const body = requestBody(route.request());
    actions.push(body.action);
    expect(route.request().headers().authorization).toBe(`Bearer ${adminSessionToken}`);
    if (body.action === 'session-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: true }) });
      return;
    }
    if (body.action === 'restrictions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ restrictions }) });
      return;
    }
    if (body.action === 'players') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ players }) });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test action.' }) });
  });
}

async function installRequiredRenameMocks(page, actions) {
  const accountPolicy = {
    attemptsUsed: 2,
    dailyAttemptsReserved: 0,
    attemptsLeft: 3,
    maxAttempts: 5,
    bonusAttempts: 0,
    authRewardBonus: 0,
    completedReferrals: 0,
    dailyLimitBase: 5,
    dailyLimitCeiling: 10,
    dailyResetAt: '2026-08-12T00:00:00.000Z',
  };

  await page.route('**/functions/v1/player-name-management', async (route) => {
    const body = requestBody(route.request());
    actions.push(body.action);
    expect(route.request().headers()['x-account-token']).toBe(accountToken);
    if (body.action === 'status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requirement: {
            required: true,
            playerId,
            temporaryNick,
            reason: 'Tu nombre de jugador debe cambiarse antes de continuar.',
          },
        }),
      });
      return;
    }
    if (body.action === 'complete') {
      expect(body.playerId).toBe(playerId);
      expect(body.nick).toBe('JugadorNuevo');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ required: false, playerId, newNick: 'JugadorNuevo' }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/functions/v1/player-context', async (route) => {
    const body = requestBody(route.request());
    expect(route.request().headers()['x-account-token']).toBe(accountToken);
    if (body.action === 'account-context') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dailyAttemptPolicy: accountPolicy }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'available', profile: null, leagues: [], dailyAttemptPolicy: accountPolicy }),
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('zadmin management exposes restrictions and player identity actions accessibly', async ({ browser, isMobile }) => {
  const context = await browser.newContext(contextOptions(isMobile));
  const page = await context.newPage();
  const video = captureEvidence ? page.video() : null;
  const runtime = collectRuntimeFailures(page);
  const actions = [];
  await page.addInitScript((token) => {
    sessionStorage.setItem('minuto106.zadmin.session.v1', token);
  }, adminSessionToken);
  await installZadminManagementMock(page, actions);

  try {
    await page.goto('/zadmin/management.html');
    await expect(page.locator('#managementDashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Restricciones y jugadores' })).toBeVisible();
    await expect(page.locator('#restrictionList .zadmin-management-item')).toHaveCount(2);
    await expect(page.getByText('Integridad automática').first()).toBeVisible();

    const automaticDetails = page.locator('#restrictionList details').first();
    await automaticDetails.locator('summary').click();
    await expect(automaticDetails.getByText('Evidencia técnica')).toBeVisible();
    await expect(automaticDetails.getByRole('button', { name: 'Quitar restricción' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, video, 'zadmin-management', isMobile);

    const liftButton = automaticDetails.getByRole('button', { name: 'Quitar restricción' });
    await liftButton.click();
    const inlineForm = automaticDetails.locator('.zadmin-management-inline-form');
    await expect(inlineForm).toBeVisible();
    await expect(inlineForm.getByLabel('Motivo')).toBeFocused();
    await inlineForm.getByLabel('Motivo').press('Escape');
    await expect(inlineForm).toHaveCount(0);
    await expect(liftButton).toBeFocused();

    await page.getByRole('button', { name: 'Jugadores' }).click();
    await expect(page.getByRole('heading', { name: 'Jugadores', exact: true })).toBeVisible();
    await expect(page.locator('#playerList').getByText('JugadorPrueba').first()).toBeVisible();
    const playerDetails = page.locator('#playerList details').first();
    await playerDetails.locator('summary').click();
    await expect(playerDetails.getByRole('button', { name: 'Renombrar ahora' })).toBeVisible();
    await expect(playerDetails.getByRole('button', { name: 'Forzar cambio de nick' })).toBeVisible();

    await page.setViewportSize({ width: 320, height: 720 });
    await assertNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Renombrar ahora' })).toBeVisible();

    expect(actions).toEqual(['session-status', 'restrictions', 'players']);
    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.consoleErrors).toEqual([]);
    expect(runtime.failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
  await saveVideo(video, 'zadmin-management', isMobile);
});

test('required nickname change traps focus, preserves state after validation and restores play after completion', async ({ browser, isMobile }) => {
  const context = await browser.newContext(contextOptions(isMobile, { account: true }));
  const page = await context.newPage();
  const video = captureEvidence ? page.video() : null;
  const runtime = collectRuntimeFailures(page);
  const actions = [];
  await installRequiredRenameMocks(page, actions);

  try {
    await page.goto('/');
    const overlay = page.locator('#nicknameRequirementOverlay');
    const input = page.locator('#nicknameRequirementInput');
    const submit = page.locator('#nicknameRequirementSubmit');
    await expect(overlay).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Elige un nuevo nombre de jugador' })).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator('#startButton')).toBeDisabled();
    await expect(page.locator('#startButton')).toHaveText('Cambia tu nick para continuar');
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(true);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, video, 'required-nickname-change', isMobile);

    await input.press('Shift+Tab');
    await expect(submit).toBeFocused();
    await submit.press('Tab');
    await expect(input).toBeFocused();

    await input.fill('x');
    await submit.click();
    await expect(overlay).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeFocused();

    await page.setViewportSize({ width: 320, height: 720 });
    await assertNoHorizontalOverflow(page);
    await expect(overlay).toBeVisible();

    await input.fill('JugadorNuevo');
    await submit.click();
    await expect(overlay).toBeHidden();
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('minuto106:nick'))).toBe('JugadorNuevo');
    expect(actions).toEqual(['status', 'complete']);

    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.consoleErrors).toEqual([]);
    expect(runtime.failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
  await saveVideo(video, 'required-nickname-change', isMobile);
});
