import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');

function projectDevice(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const path = resolve(previewRoot, `home-ranking-${projectDevice(testInfo)}.png`);
  mkdirSync(previewRoot, { recursive: true });
  const leaderboard = page.locator('.leaderboard-card');
  if (await leaderboard.isVisible()) {
    await leaderboard.screenshot({ path, animations: 'disabled' });
    return;
  }
  await page.screenshot({ path, animations: 'disabled', fullPage: true });
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
    totalAttempts: 30,
    totalPlayers: 8,
    verifiedAttempts: 28,
    perfectAttempts: 0,
    teams: [
      { team: 'spain', score: 292 },
      { team: 'argentina', score: 99 },
    ],
    leaderboard: [
      { nick: 'Vieucirst', team: 'spain', elapsedMs: 10604, differenceMs: 4 },
      { nick: 'NombreMuyMuyMuyLargo123', team: 'argentina', elapsedMs: 10614, differenceMs: 14 },
      { nick: 'Chamuca', team: 'spain', elapsedMs: 10789, differenceMs: 189 },
    ],
    awards: {
      goldenBoot: null,
      goldenGlove: null,
      goldenBall: null,
    },
  };
}

async function installMocks(page) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: globalThis.document.documentElement.clientWidth,
    content: globalThis.document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test('home places mobile awards below the score and keeps ranking rows on two stable lines', async ({ page, isMobile }, testInfo) => {
  await installMocks(page);
  await page.goto('/');

  const rows = page.locator('#leaderboard .leaderboard-row-link');
  const awards = page.locator('#awardsCard');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.stats-strip')).toHaveCount(0);
  await expect(page.getByText('jugadores globales', { exact: true })).toHaveCount(0);
  await expect(page.getByText('intentos globales validados', { exact: true })).toHaveCount(0);
  await expect(page.getByText('tiempos globales perfectos', { exact: true })).toHaveCount(0);

  const first = rows.first();
  const firstFlag = first.locator('img.ranking-flag');
  await expect(firstFlag).toHaveAttribute('alt', 'España');
  await expect(firstFlag).toHaveAttribute('src', /assets\/flag-spain\.svg$/);
  await expect(first).not.toContainText('España');
  await expect(first.locator('.ranking-time')).toHaveText('10.604s');

  const second = rows.nth(1);
  await expect(second.locator('img.ranking-flag')).toHaveAttribute('alt', 'Argentina');
  await expect(second).not.toContainText('Argentina');

  if (isMobile) {
    await expect(page.locator('.leaderboard-card')).toBeHidden();
    await expect(awards).toBeVisible();
    const awardsFollowScore = await page.evaluate(() => globalThis.document.querySelector('.battle-card')?.nextElementSibling?.id === 'awardsCard');
    expect(awardsFollowScore).toBe(true);
  } else {
    const awardsInDesktopRail = await awards.evaluate((card) => (
      card.parentElement?.classList.contains('layout-rail--right') === true
      && card.parentElement.firstElementChild === card
    ));
    expect(awardsInDesktopRail).toBe(true);

    for (const row of await rows.all()) {
      const geometry = await row.evaluate((anchor) => {
        const center = (box) => box.top + (box.height / 2);
        const rank = anchor.querySelector('.rank');
        const identity = anchor.querySelector('.ranking-player__identity');
        const flag = anchor.querySelector('.ranking-flag');
        const nick = anchor.querySelector('.player-link__nick');
        const time = anchor.querySelector('.ranking-time');
        const difference = anchor.querySelector('.difference');
        const flagBox = flag.getBoundingClientRect();
        const nickBox = nick.getBoundingClientRect();
        const timeBox = time.getBoundingClientRect();
        const differenceBox = difference.getBoundingClientRect();
        const itemStyle = globalThis.getComputedStyle(anchor.parentElement);
        return {
          height: anchor.getBoundingClientRect().height,
          firstRowCenterDelta: Math.abs(center(flagBox) - center(nickBox)),
          secondRowCenterDelta: Math.abs(center(timeBox) - center(differenceBox)),
          rowsAreSeparated: Math.max(flagBox.bottom, nickBox.bottom) < Math.min(timeBox.top, differenceBox.top),
          rankRowStart: globalThis.getComputedStyle(rank).gridRowStart,
          rankRowEnd: globalThis.getComputedStyle(rank).gridRowEnd,
          identityRow: globalThis.getComputedStyle(identity).gridRowStart,
          timeRow: globalThis.getComputedStyle(time).gridRowStart,
          differenceRow: globalThis.getComputedStyle(difference).gridRowStart,
          timeWhiteSpace: globalThis.getComputedStyle(time).whiteSpace,
          nickWhiteSpace: globalThis.getComputedStyle(nick).whiteSpace,
          nickOverflow: globalThis.getComputedStyle(nick).overflow,
          itemBackground: itemStyle.backgroundColor,
          itemTransform: itemStyle.transform,
        };
      });
      expect(geometry.height).toBeLessThanOrEqual(58);
      expect(geometry.firstRowCenterDelta).toBeLessThanOrEqual(3);
      expect(geometry.secondRowCenterDelta).toBeLessThanOrEqual(3);
      expect(geometry.rowsAreSeparated).toBe(true);
      expect(geometry.rankRowStart).toBe('1');
      expect(geometry.rankRowEnd).toBe('span 2');
      expect(geometry.identityRow).toBe('1');
      expect(geometry.timeRow).toBe('2');
      expect(geometry.differenceRow).toBe('2');
      expect(geometry.timeWhiteSpace).toBe('nowrap');
      expect(geometry.nickWhiteSpace).toBe('nowrap');
      expect(geometry.nickOverflow).toBe('hidden');
      expect(geometry.itemBackground).toBe('rgba(0, 0, 0, 0)');
      expect(geometry.itemTransform).toBe('none');
    }

    const beforeHover = await first.evaluate((anchor) => anchor.getBoundingClientRect().left);
    await first.hover();
    const afterHover = await first.evaluate((anchor) => anchor.getBoundingClientRect().left);
    expect(Math.abs(afterHover - beforeHover)).toBeLessThanOrEqual(.5);
  }

  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo);
});
