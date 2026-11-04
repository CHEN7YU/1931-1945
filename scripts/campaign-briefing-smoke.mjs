import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.GAME_URL ?? 'http://127.0.0.1:5203';
const capture = async name => {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
};
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.goto(base);
  await page.locator('#menu').waitFor({ state: 'visible' });
  assert.match(await page.locator('#campaign-history').textContent(), /徐州会战/);
  assert.equal(await page.locator('#campaign-goals li').count(), 3);
  await capture('taierzhuang-selection.png');
  await page.locator('#campaign-choice').selectOption('nanjing');
  assert.match(await page.locator('#campaign-history').textContent(), /12月13日南京沦陷/);
  assert.match(await page.locator('#campaign-goals').textContent(), /中华门.*上新河.*返航木船/);
  assert.match(await page.locator('#campaign-history-source').getAttribute('href'), /19371213\.com\.cn/);
  await capture('nanjing-selection.png');
  const fullscreenSupported = await page.evaluate(() => document.fullscreenEnabled);
  if (fullscreenSupported) {
    await page.locator('#menu [data-fullscreen-toggle]').click();
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    assert.equal(await page.locator('#menu [data-fullscreen-toggle]').textContent(), '退出全屏');
    await page.locator('#menu [data-fullscreen-toggle]').click();
    await page.waitForFunction(() => !document.fullscreenElement);
  } else assert.equal(await page.locator('#menu [data-fullscreen-toggle]').isDisabled(), true);

  const missions = [];
  for (const id of ['nanjing', 'taierzhuang-fort']) {
    await page.goto(id === 'nanjing' ? `${base}/?campaign=nanjing` : base);
    if (id === 'nanjing') {
      await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
      assert.equal(await page.locator('#menu-photo-wall').isVisible(), false);
      assert.match(await page.locator('#selected-campaign-preview img').getAttribute('src'), /nanjing\.webp/);
      assert.equal(await page.locator('#player-unit-cards label').count(), 5);
      await page.locator('#player-nickname').fill('联调玩家');
      await page.locator('input[name="player-unit"][value="custom"]').check();
      await page.locator('#custom-squad-name').fill('江城自定义小队');
      await capture('nanjing-preparation.png');
      await page.locator('#deploy').click();
    } else {
      await page.locator('#confirm-campaign').click();
      assert.equal(await page.locator('#menu-photo-wall').isVisible(), false);
      assert.match(await page.locator('#deployment-campaign-context img').getAttribute('src'), /taierzhuang-fort\.webp/);
      assert.equal(await page.locator('#player-unit-cards label').count(), 4);
      await page.locator('input[name="player-unit"][value="20-corps"]').check();
      await capture('taierzhuang-unit-selection.png');
      await page.locator('#redeploy-choices [data-type="infantry"]').click();
      assert.match(await page.locator('#deployment-campaign-context').textContent(), /本关作战目标/);
      await page.locator('#confirm-deploy').click();
    }
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    await page.locator('#mission-briefing').waitFor({ state: 'visible' });
    const text = await page.locator('#mission-briefing').textContent();
    assert.match(text, id === 'nanjing' ? /中华门.*上新河.*登船/ : /A点粮栈.*C点布防20秒.*2\/3/);
    assert.equal(await page.locator('#mission-briefing li').count(), 3);
    assert.equal(await page.locator('#members [data-role-icon="sniper"]').count(), 1);
    assert.equal(await page.locator('#members [data-role-icon="mortarman"]').count(), 1);
    assert.equal(await page.locator('#members [data-role-icon="machine-gunner"]').count(), 1);
    assert.match(await page.locator('#minimap-mission').textContent(), id === 'nanjing' ? /中华门/ : /夺取 A/);
    const playerRows = await page.evaluate(() => window.__battle.squadScores.filter(row => row.player));
    assert.equal(playerRows.length, 1); assert.equal(playerRows[0].name, '联调玩家');
    const bounds = await page.locator('#mission-briefing').boundingBox();
    assert.ok(bounds.x + bounds.width < 1280 / 2, 'briefing must not cover the crosshair');
    await capture(`${id}-opening-objectives.png`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__battle?.state === 'pause');
    const pausedAt = await page.evaluate(() => window.__battle.time);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__battle.time), pausedAt);
    assert.equal(await page.locator('#mission-briefing').isVisible(), true);
    if (fullscreenSupported) {
      await page.locator('#overlay [data-fullscreen-toggle]').click();
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      assert.equal(await page.evaluate(() => window.__battle.state), 'pause');
      await page.locator('#overlay [data-fullscreen-toggle]').click();
      await page.waitForFunction(() => !document.fullscreenElement);
    }
    await page.locator('#resume').click();
    await page.keyboard.press('Enter');
    await page.locator('#mission-briefing').waitFor({ state: 'hidden' });
    missions.push({ id, text, pausedAt });
  }
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'campaign-briefings.json'),
    JSON.stringify({ fullscreenSupported, missions, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, fullscreenSupported, campaigns: missions.map(mission => mission.id), errors }));
} finally { await browser.close(); }
