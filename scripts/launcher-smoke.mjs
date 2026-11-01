import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#menu').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#game-title').textContent(), '山河');
  assert.equal(await page.locator('#campaign-choice').count(), 1);
  assert.equal(await page.locator('#campaign-buttons').count(), 0);
  assert.equal(await page.locator('#menu .map-preview').count(), 0);
  assert.equal(await page.locator('#menu-settings').evaluate(details => details.open), false);
  assert.equal(await page.locator('#campaign-choice option:disabled').count(), 2);
  assert.equal(await page.locator('#campaign-choice option:not(:disabled)').count(), 1);
  assert.equal(await page.locator('#campaign-choice option[value="taierzhuang-streets"]').count(), 0);
  assert.equal(await page.locator('#campaign-choice').inputValue(), 'taierzhuang-fort');
  await page.locator('#campaign-choice').selectOption('taierzhuang-fort');
  assert.match(await page.locator('#campaign-description').textContent(), /粮栈高楼/);
  assert.doesNotMatch(await page.locator('#campaign-description').textContent(), /第二阶段|三据点争夺/);
  await page.locator('#menu-settings > summary').click();
  assert.equal(await page.locator('#menu-settings').evaluate(details => details.open), true);
  await page.locator('#menu-settings > summary').click();
  const observations = [];
  if (process.env.ARTIFACT_DIR) await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [450, 900]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#menu').evaluate(menu => { menu.scrollTop = 0; });
    const title = await page.locator('#game-title').boundingBox();
    assert.ok(title && title.x >= 0 && title.x + title.width <= width + 1);
    if (width > 800) {
      const panel = await page.locator('.operation-panel').boundingBox();
      assert.ok(title.x + title.width < panel.x, 'the game title must not overlap the single campaign selector');
      const map = await page.locator('#menu-photo-wall').boundingBox();
      const footer = await page.locator('.menu-footer').boundingBox();
      assert.ok(map.x + map.width <= panel.x - 20, 'the enlarged wall must leave a usable gap before deployment controls');
      assert.ok(map.width > width * .53, 'the photo wall uses the middle space rather than a narrow left column');
      assert.ok(footer.y >= map.y + map.height, 'shortened controls must not lift the footer over the campaign map');
    } else {
      const map = await page.locator('#menu-photo-wall').boundingBox();
      const panel = await page.locator('.operation-panel').boundingBox();
      assert.ok(panel.y >= map.y + map.height, 'the narrow-layout campaign map must not overlap the controls');
    }
    await page.locator('#confirm-campaign').scrollIntoViewIfNeeded();
    const button = await page.locator('#confirm-campaign').boundingBox();
    assert.ok(button && button.y >= 0 && button.y + button.height <= height);
    observations.push({ width, height, title, button });
    if (process.env.ARTIFACT_DIR) await page.screenshot({
      path: join(process.env.ARTIFACT_DIR, `launcher-${width}x${height}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#confirm-campaign').click();
  await page.locator('#deployment-options').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#overlay-title').textContent(), '台儿庄 · 城寨攻防');
  assert.equal(await page.locator('#pause-settings').isVisible(), false);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  assert.ok(!requests.some(url => url.includes('/src/main.js') || url.includes('/assets/game/')),
    'cleaning the menu must not load combat resources before deployment');
  await page.locator('#back-menu').click();
  assert.equal(await page.locator('#campaign-choice').inputValue(), 'taierzhuang-fort');
  const legacy = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  legacy.searchParams.set('campaign', 'taierzhuang-streets');
  await page.goto(legacy.href);
  await page.locator('#menu').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#campaign-choice').inputValue(), 'taierzhuang-fort',
    'an old streets link must fall back to the remaining visible map');
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'launcher.json'),
    JSON.stringify({ observations, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, viewports: observations.length, singleCampaignSelector: true,
    settingsCollapsed: true, deploymentPreserved: true }));
} finally {
  await browser.close();
}
