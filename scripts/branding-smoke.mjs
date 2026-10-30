import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
const watchdog = setTimeout(() => { console.error('Branding check exceeded 240s'); void browser.close(); }, 240000);
try {
  const settings = defaultPreferences();
  settings.mouseSensitivity = 1.5; settings.aimSensitivity = .75; settings.quality.preset = 'low';
  await page.addInitScript(({ key, settings }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, settings }));
  }, { key: PREFERENCES_KEY, settings });
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5214/');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  assert.equal(await page.title(), '山河 · 1931-1945');
  assert.equal(await page.locator('#game-title').textContent(), '山河');
  assert.equal(await page.locator('.game-subtitle').textContent(), '1931-1945');
  assert.doesNotMatch(await page.locator('#menu').textContent(), /烽火|EMBERS OF CHINA/);
  assert.equal(await page.evaluate(() => window.__battle.preferences.mouseSensitivity), 1.5);
  assert.equal(await page.evaluate(() => window.__battle.preferences.aimSensitivity), .75);
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [450, 900]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#menu').evaluate(menu => { menu.scrollTop = 0; });
    const title = await page.locator('#game-title').boundingBox();
    const subtitle = await page.locator('.game-subtitle').boundingBox();
    assert.ok(title && subtitle);
    for (const box of [title, subtitle]) {
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(box.y >= 0 && box.y + box.height <= height);
    }
    assert.ok(subtitle.y >= title.y + title.height, 'the subtitle has its own row below the title');
    const panel = await page.locator('.operation-panel').boundingBox();
    if (width > 800) assert.ok(title.x + title.width < panel.x, 'main title does not overlap deployment controls');
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `shanhe-${width}x${height}.png`) });
    }
    await page.locator('#deploy').scrollIntoViewIfNeeded();
    const deploy = await page.locator('#deploy').boundingBox();
    assert.ok(deploy && deploy.y >= 0 && deploy.y + deploy.height <= height);
    observations.push({ width, height, title, subtitle, deploy });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing', null, { timeout: 20000 });
  assert.equal(await page.title(), '山河 · 1931-1945');
  assert.equal(await page.evaluate(() => window.__battle.preferences.mouseSensitivity), 1.5);
  await page.goto(new URL('/town-preview.html', url).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__townPreview?.ready, null, { timeout: 120000 });
  assert.equal(await page.title(), '山河 · 1931-1945 · 城寨空地图评审');
  assert.match(await page.locator('header .eyebrow').textContent(), /山河 · 1931-1945/);
  assert.equal(await page.evaluate(() => window.__townPreview.combatActors), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: exact title/subtitle, desktop/sidebar layout, deployment, preserved preferences and separate branded map preview.');
} finally {
  clearTimeout(watchdog);
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'branding-observations.json'), JSON.stringify({ observations, errors }, null, 2));
    }
  } finally { await browser.close(); }
}
