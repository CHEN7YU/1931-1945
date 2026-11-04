import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'build-version');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], observations = [], production = process.env.PRODUCTION === '1';
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173/');
  url.searchParams.set('character', 'procedural');
  if (!production) url.searchParams.set('benchmark', 'bridge');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' && !document.querySelector('#menu').hidden,
    null, { timeout: 60000 });
  async function inspect(stage, selector, visible = true) {
    if (visible) await page.locator(selector).scrollIntoViewIfNeeded();
    const data = await page.evaluate(selector => {
      const element = document.querySelector(selector), box = element.getBoundingClientRect();
      const parent = element.closest('.operation-panel,.dialog').getBoundingClientRect();
      return { build: window.__battle.build, text: element.textContent, title: element.title,
        visible: element.getClientRects().length > 0, top: box.top, bottom: box.bottom,
        left: box.left, right: box.right, parentLeft: parent.left, parentRight: parent.right, parentBottom: parent.bottom,
        viewport: innerHeight, font: getComputedStyle(element).fontSize };
    }, selector);
    observations.push({ stage, ...data });
    assert.equal(data.visible, visible);
    assert.equal(data.build.development, !production);
    assert.ok(data.text.includes(data.build.commit?.slice(0, 7) ?? '未知'));
    assert.match(data.text, production ? /^构建/ : /^开发预览/);
    if (production && data.build.dirty) assert.match(data.text, /含未提交改动/);
    if (visible) {
      assert.ok(data.top >= 0 && data.bottom <= data.viewport && data.bottom <= data.parentBottom);
      assert.ok(data.left >= data.parentLeft && data.right <= data.parentRight);
    }
    assert.ok(Number.parseFloat(data.font) >= 12);
    assert.ok(data.title.includes(data.build.builtAt) && data.title.includes(data.build.commit ?? '未知'));
    await page.screenshot({ path: join(directory, `${stage}.png`) });
    return data;
  }
  const menu = await inspect('lobby', '#menu [data-build-version]');
  assert.equal(await page.locator('[data-build-version]').count(), 2);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle.state === 'playing');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const pausedTime = await page.evaluate(() => window.__battle.time);
  assert.ok(Number.isFinite(pausedTime));
  const pause = await inspect('pause', '#overlay [data-build-version]', false);
  assert.equal(pause.text, menu.text);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__battle.time), pausedTime);
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, production, version: menu.text, directory }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
