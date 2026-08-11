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
const secondPlayerId = '10600000-0000-4000-8000-000000000077';
const accountId = '10600000-0000-4000-8000-000000000075';
const originalNick = 'JugadorAnterior';
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

function pageMeta(total, pageSize = 25, page = 1) {
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  return { page, pageSize, total, totalPages, hasPrevious: page > 1, hasNext: totalPages > page };
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
    cooldown: { canRename: true, nextRenameAt: null, retryAfterSeconds: 0 },
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
      expect([10, 25, 50]).toContain(body.pageSize);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: restrictions, pagination: pageMeta(restrictions.length, body.pageSize, body.page) }) });
      return;
    }
    if (body.action === 'players') {
      expect([10, 25, 50]).toContain(body.pageSize);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: players, pagination: pageMeta(players.length, body.pageSize, body.page) }) });
      return;
    }
    if (body.action === 'check-nickname') {
      expect(body.playerId).toBe(playerId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ availability: 'available', normalizedNick: body.nick }) });
      return;
    }
    if (body.action === 'rename-player') {
      expect(body.playerId).toBe(playerId);
      expect(body.nick).toBe('JugadorAdmin');
      expect(body.reason).toBe('Corrección administrativa verificada.');
      players[0].nick = 'JugadorAdmin';
      players[0].nickKey = 'jugadoradmin';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ playerId, newNick: 'JugadorAdmin' }) });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test action.' }) });
  });
}

async function installRequiredRenameMocks(page, actions) {
  let requirementActive = true;
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
          requirement: requirementActive ? {
            required: true,
            playerId,
            originalNick,
            temporaryNick,
            reason: 'Tu nombre de jugador debe cambiarse antes de continuar.',
          } : null,
        }),
      });
      return;
    }
    if (body.action === 'check') {
      expect(body.playerId).toBe(playerId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ availability: 'available', normalizedNick: body.nick }) });
      return;
    }
    if (body.action === 'complete') {
      expect(body.playerId).toBe(playerId);
      expect(body.nick).toBe('JugadorNuevo');
      requirementActive = false;
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

async function installAccountNicknameMocks(page, actions) {
  const nextRenameAt = new Date(Date.now() + (6 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString();
  let firstPlayerBlocked = false;
  const accountPlayers = [
    { playerId, nick: 'JugadorUno', team: 'spain', bestDifferenceMs: 12, attemptsLeft: 3 },
    { playerId: secondPlayerId, nick: 'JugadorDos', team: 'argentina', bestDifferenceMs: 31, attemptsLeft: 4 },
  ];

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'account-players') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ players: accountPlayers }) });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route('**/functions/v1/player-name-management', async (route) => {
    const body = requestBody(route.request());
    actions.push(body.action);
    expect(route.request().headers()['x-account-token']).toBe(accountToken);
    if (body.action === 'status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requirement: null }) });
      return;
    }
    if (body.action === 'list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ players: [
          {
            playerId,
            nick: 'JugadorUno',
            renameRequired: false,
            originalNick: null,
            cooldown: firstPlayerBlocked
              ? { canRename: false, nextRenameAt, retryAfterSeconds: 6 * 24 * 60 * 60 }
              : { canRename: true, nextRenameAt: null, retryAfterSeconds: 0 },
          },
          {
            playerId: secondPlayerId,
            nick: 'JugadorDos',
            renameRequired: false,
            originalNick: null,
            cooldown: { canRename: true, nextRenameAt: null, retryAfterSeconds: 0 },
          },
        ] }),
      });
      return;
    }
    if (body.action === 'check') {
      expect(body.playerId).toBe(playerId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ availability: 'available', normalizedNick: body.nick }) });
      return;
    }
    if (body.action === 'rename') {
      expect(body.playerId).toBe(playerId);
      expect(body.nick).toBe('JugadorNuevo');
      firstPlayerBlocked = true;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Este nick ya fue cambiado esta semana.', code: 'nickname_cooldown', nextRenameAt, retryAfterSeconds: 6 * 24 * 60 * 60 }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/functions/v1/account-auth', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) });
  });

  return { nextRenameAt };
}

test('zadmin management exposes paginated restrictions and performs admin nickname rename through shared checks', async ({ browser, isMobile }) => {
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
    await expect(page.locator('#restrictionPageStatus')).toContainText('Página 1 de 1');
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
    await expect(page.locator('#playerPageStatus')).toContainText('Página 1 de 1');
    await expect(page.locator('#playerList').getByText('JugadorPrueba').first()).toBeVisible();
    let playerDetails = page.locator('#playerList details').first();
    await playerDetails.locator('summary').click();
    const renameButton = playerDetails.getByRole('button', { name: 'Renombrar ahora' });
    await expect(renameButton).toBeVisible();
    await expect(playerDetails.getByRole('button', { name: 'Forzar cambio de nick' })).toBeVisible();

    await renameButton.click();
    const renameForm = playerDetails.locator('.zadmin-management-inline-form');
    await renameForm.getByLabel('Nuevo nick').fill('JugadorAdmin');
    await expect(renameForm.getByRole('button', { name: 'Guardar nuevo nick' })).toBeEnabled();
    await renameForm.getByLabel('Motivo administrativo').fill('Corrección administrativa verificada.');
    await renameForm.getByRole('button', { name: 'Guardar nuevo nick' }).click();
    await expect(page.locator('#playerList').getByText('JugadorAdmin').first()).toBeVisible();

    playerDetails = page.locator('#playerList details').first();
    await playerDetails.locator('summary').click();
    await page.setViewportSize({ width: 320, height: 720 });
    await assertNoHorizontalOverflow(page);
    await expect(playerDetails.getByRole('button', { name: 'Renombrar ahora' })).toBeVisible();

    expect(actions).toEqual(['session-status', 'restrictions', 'players', 'check-nickname', 'rename-player', 'players']);
    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.consoleErrors).toEqual([]);
    expect(runtime.failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
  await saveVideo(video, 'zadmin-management', isMobile);
});

test('required nickname change shows old/current names, shares checks, traps focus and restores play', async ({ browser, isMobile }) => {
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
    await expect(page.locator('#nicknameRequirementOriginal')).toHaveText(originalNick);
    await expect(page.locator('#nicknameRequirementTemporary')).toHaveText(temporaryNick);
    await expect(input).toBeFocused();
    await expect(page.locator('#startButton')).toBeDisabled();
    await expect(page.locator('#startButton')).toHaveText('Cambia tu nick para continuar');
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(true);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, video, 'required-nickname-change', isMobile);

    await input.press('Shift+Tab');
    await expect(input).toBeFocused();

    await input.fill('x');
    await expect(submit).toBeDisabled();
    await expect(overlay).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeFocused();

    await page.setViewportSize({ width: 320, height: 720 });
    await assertNoHorizontalOverflow(page);
    await expect(overlay).toBeVisible();

    await input.fill('JugadorNuevo');
    await expect(submit).toBeEnabled();
    await submit.focus();
    await submit.press('Tab');
    await expect(input).toBeFocused();
    await submit.click();
    await expect(overlay).toBeHidden();
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('minuto106:nick'))).toBe('JugadorNuevo');
    expect(actions.slice(0, 3)).toEqual(['status', 'check', 'complete']);

    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.consoleErrors).toEqual([]);
    expect(runtime.failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
  await saveVideo(video, 'required-nickname-change', isMobile);
});

test('account rename reloads the authoritative per-player weekly cooldown after a rejected attempt', async ({ browser, isMobile }) => {
  const context = await browser.newContext(contextOptions(isMobile, { account: true }));
  const page = await context.newPage();
  const runtime = collectRuntimeFailures(page);
  const actions = [];
  await installAccountNicknameMocks(page, actions);

  try {
    await page.goto('/cuenta.html');
    const players = page.locator('#accountPlayers .account-player');
    await expect(players).toHaveCount(2);
    await expect(page.locator('#accountPlayersStatus')).toContainText('2 nicks vinculados');

    const first = players.nth(0);
    const second = players.nth(1);
    const firstRename = first.getByRole('button', { name: 'Cambiar nick' });
    const secondRename = second.getByRole('button', { name: 'Cambiar nick' });
    await expect(firstRename).toBeEnabled();
    await expect(secondRename).toBeEnabled();

    await firstRename.click();
    const form = first.locator('.account-player-rename-form');
    await expect(form.getByText('Cambiar “JugadorUno”')).toBeVisible();
    await form.getByLabel('Nuevo nick').fill('JugadorNuevo');
    await expect(form.getByRole('button', { name: 'Guardar nick' })).toBeEnabled();
    await form.getByRole('button', { name: 'Guardar nick' }).click();

    const refreshedPlayers = page.locator('#accountPlayers .account-player');
    const blockedPlayer = refreshedPlayers.nth(0);
    const independentPlayer = refreshedPlayers.nth(1);
    await expect(blockedPlayer.locator('[data-nickname-cooldown]')).toContainText('Disponible');
    await expect(blockedPlayer.locator('[data-nickname-cooldown]')).toContainText(/\d+d \d{2}:\d{2}:\d{2}/);
    await expect(blockedPlayer.getByRole('button', { name: 'Cambiar nick' })).toBeDisabled();
    await expect(independentPlayer.locator('[data-nickname-cooldown]')).toHaveText('Puedes volver a cambiar este nick ahora.');
    await expect(independentPlayer.getByRole('button', { name: 'Cambiar nick' })).toBeEnabled();

    await page.setViewportSize({ width: 320, height: 720 });
    await assertNoHorizontalOverflow(page);
    expect(actions).toContain('status');
    expect(actions.filter((action) => action !== 'status')).toEqual(['list', 'check', 'rename', 'list']);
    expect(runtime.pageErrors).toEqual([]);
    const unexpectedConsoleErrors = runtime.consoleErrors.filter((message) => !message.includes('status of 429'));
    expect(unexpectedConsoleErrors).toEqual([]);
    expect(runtime.consoleErrors.some((message) => message.includes('status of 429'))).toBe(true);
    expect(runtime.failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
});