import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = new URL('/uniform-study/', process.env.GAME_URL || 'http://127.0.0.1:5187');
const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [], requests = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
page.on('request', request => requests.push(request.url()));
const snapshot = () => page.evaluate(() => window.__uniformStudy);
try {
  await page.goto(url.href);
  await page.waitForFunction(() => window.__uniformStudy?.ready || window.__uniformStudy?.fatal);
  const initial = await snapshot();
  assert.equal(initial.fatal, null);
  assert.equal(initial.battlefieldConnected, false);
  assert.equal(initial.rigged, false);
  assert.equal(initial.skinBaked, true);
  assert.equal(initial.tailoredUpperBody, true);
  assert.equal(initial.balancedSilhouette, true);
  assert.equal(initial.selectedPart, 'uniform');
  assert.ok(initial.drawCalls > 0);
  assert.ok(initial.triangles > 0);
  observations.push({ stage: 'loaded', ...initial });
  if (out) await page.screenshot({ path: join(out, 'uniform-study-overview.png'), fullPage: true });
  for (const name of ['front', 'side', 'back', 'detail', 'three-quarter']) {
    await page.locator(`[data-view="${name}"]`).click();
    assert.equal(await page.locator(`[data-view="${name}"]`).getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(100);
    observations.push({ stage: name, ...await snapshot() });
    if (out) await page.locator('.stage-panel').screenshot({ path: join(out, `uniform-study-${name}.png`) });
    if (out && name === 'front') await page.locator('.stage-panel').screenshot({ path: join(out, 'uniform-study-after-balance-front.png') });
    if (out && name === 'detail') await page.locator('#stage').screenshot({ path: join(out, 'uniform-study-after-balance-detail.png') });
    if (out && name === 'three-quarter') await page.locator('.stage-panel').screenshot({ path: join(out, 'uniform-study-after-balance-three-quarter.png') });
  }
  await page.locator('#helmet-toggle').uncheck();
  assert.equal((await snapshot()).helmetVisible, false);
  await page.locator('#equipment-toggle').uncheck();
  assert.equal((await snapshot()).equipmentVisible, false);
  await page.locator('[data-view="front"]').click();
  if (out) await page.locator('.stage-panel').screenshot({ path: join(out, 'uniform-study-balanced-uniform-only.png') });
  await page.locator('[data-view="detail"]').click();
  if (out) await page.locator('.stage-panel').screenshot({ path: join(out, 'uniform-study-tailored-upper-body.png') });
  await page.locator('#helmet-toggle').check();
  await page.locator('#equipment-toggle').check();
  await page.locator('[data-view="three-quarter"]').click();
  for (const part of ['insignia', 'helmet', 'pouches', 'canteen', 'haversack', 'boots', 'uniform']) {
    await page.locator(`[data-part="${part}"]`).click();
    assert.equal((await snapshot()).selectedPart, part);
    assert.ok(await page.locator('#uncertainty').innerText());
    assert.match(await page.locator('#source-link').getAttribute('href'), /^https:/);
  }
  const canvas = await page.locator('#stage').boundingBox();
  const before = (await snapshot()).camera;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 90, canvas.y + canvas.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.notDeepEqual((await snapshot()).camera, before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__uniformStudy.rendererSize[0] < 400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (out) await page.screenshot({ path: join(out, 'uniform-study-mobile.png'), fullPage: true });
  assert.ok(requests.every(request => request.startsWith(url.origin) || request.startsWith('data:') || request.startsWith('blob:')));
  assert.ok(!requests.some(request => /\/src\/(?:main|world|battlefield|combat-|nra-)/.test(request)));
  assert.ok(!requests.some(request => /\/nra-88\/(?:body|badge|patch|ranks)\./.test(request)), 'source national uniform textures must not be used by the adapted garment');
  assert.deepEqual(errors, []);

  const failed = await browser.newPage();
  await failed.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = function () { return null; };
  });
  await failed.goto(url.href);
  await failed.waitForFunction(() => Boolean(window.__uniformStudy?.fatal));
  assert.equal(await failed.locator('#error').isVisible(), true);
  assert.equal(await failed.locator('#helmet-toggle').isDisabled(), true);
  assert.equal(await failed.evaluate(() => window.__uniformStudy.ready), false);
  await failed.close();
  const missingSkin = await browser.newPage();
  await missingSkin.route('**/assets/game/nra-88/character.fbx', route => route.fulfill({ status: 404, body: 'Intentional missing static skin source' }));
  await missingSkin.goto(url.href);
  await missingSkin.waitForFunction(() => Boolean(window.__uniformStudy?.fatal));
  assert.equal(await missingSkin.locator('#error').isVisible(), true);
  assert.equal(await missingSkin.evaluate(() => window.__uniformStudy.ready), false);
  assert.equal(await missingSkin.evaluate(() => window.__uniformStudy.skinBaked), false);
  await missingSkin.close();
  const missingTexture = await browser.newPage();
  await missingTexture.route('**/assets/game/nra-88/hand.jpg', route => route.fulfill({ status: 404, body: 'Intentional missing hand texture' }));
  await missingTexture.goto(url.href);
  await missingTexture.waitForFunction(() => Boolean(window.__uniformStudy?.fatal));
  assert.match(await missingTexture.locator('#error').innerText(), /hand\.jpg/);
  assert.equal(await missingTexture.evaluate(() => window.__uniformStudy.ready), false);
  await missingTexture.close();
  console.log('PASS: isolated static study, all camera views, orbit input, equipment toggles, evidence sources, mobile layout, local-only requests and explicit WebGL failure.');
} finally {
  if (out) await writeFile(join(out, 'uniform-study-observations.json'), JSON.stringify({ observations, requests, errors }, null, 2));
  await browser.close();
}
