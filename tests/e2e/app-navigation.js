export async function openApplicationPage(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('body').waitFor({ state: 'visible' });
}
