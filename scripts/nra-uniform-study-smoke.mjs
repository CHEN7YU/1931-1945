import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = new URL('/nra-study/', process.env.GAME_URL || 'http://127.0.0.1:5189');
const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], requests = [], observations = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(request.url()));
  await page.goto(url.href);
  await page.waitForFunction(() => window.__nraUniformStudy?.ready || window.__nraUniformStudy?.fatal, null, { timeout: 60000 });
  const snapshot = () => page.evaluate(() => window.__nraUniformStudy);
  const initial = await snapshot();
  assert.equal(initial.fatal, null); assert.equal(initial.ready, true);
  assert.equal(initial.battlefieldConnected, false); assert.equal(initial.staticOnly, true);
  assert.ok(initial.changedVertices > 20000); assert.ok(initial.triangles > 0);
  observations.push(initial);
  if (out) await page.screenshot({ path: join(out, 'nra-comparison.png'), fullPage: true });
  for (const mode of ['compare', 'remake']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    assert.equal((await snapshot()).originalVisible, mode === 'compare');
    for (const view of ['front', 'side', 'back', 'detail', 'three-quarter']) {
      await page.locator(`[data-view="${view}"]`).click();
      assert.equal((await snapshot()).view, view);
      observations.push(await snapshot());
      if (out) await page.screenshot({ path: join(out, `nra-${mode}-${view}.png`), fullPage: true });
    }
  }
  await page.locator('#equipment').uncheck();
  assert.equal((await snapshot()).equipmentVisible, false);
  if (out) await page.screenshot({ path: join(out, 'nra-garment-only.png'), fullPage: true });
  await page.locator('#equipment').check();
  const canvas = await page.locator('#stage').boundingBox(), before = (await snapshot()).camera;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 120, canvas.y + canvas.height / 2, { steps: 12 });
  await page.mouse.up();
  assert.notDeepEqual((await snapshot()).camera, before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__nraUniformStudy.rendererSize[0] < 400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (out) await page.screenshot({ path: join(out, 'nra-mobile.png'), fullPage: true });
  assert.ok(requests.every(request => request.startsWith(url.origin) || /^(data:|blob:)/.test(request)));
  assert.ok(!requests.some(request => /\/src\/(?:main|world|battlefield)\.js/.test(request)));
  assert.deepEqual(errors, []);
  await page.close();

  for (const failure of ['model', 'texture', 'webgl']) {
    const failed = await browser.newPage();
    if (failure === 'webgl') await failed.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.startsWith('webgl') ? null : original.call(this, type, ...args);
      };
    });
    else await failed.route(`**/assets/game/nra-88/${failure === 'model' ? 'character.fbx' : 'body.jpg'}`,
      route => route.fulfill({ status: 404, body: 'Intentional missing study asset' }));
    await failed.goto(url.href);
    await failed.waitForFunction(() => Boolean(window.__nraUniformStudy?.fatal), null, { timeout: 60000 });
    assert.equal(await failed.locator('#error').isVisible(), true);
    assert.equal(await failed.locator('[data-mode="remake"]').isDisabled(), true);
    assert.equal(await failed.evaluate(() => window.__nraUniformStudy.ready), false);
    await failed.close();
  }
  console.log('PASS: isolated uniform comparison, geometric folds, views, controls, responsive layout and explicit failure states.');
} finally {
  if (out) await writeFile(join(out, 'nra-study-observations.json'), JSON.stringify({ observations, errors, requests }, null, 2));
  await browser.close();
}
