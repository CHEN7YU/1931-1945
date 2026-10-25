import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const url = process.env.GAME_URL || 'http://127.0.0.1:5173';
const fixtureSource = { license: 'CC0-1.0', source: 'original flat-color test fixture', normalFormat: 'OpenGL' };
async function open(config, missing = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/assets/weapons/test/')) requests.push(request.url()); });
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.fillStyle = '#8080ff'; context.fillRect(0, 0, 1, 1);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  if (config) await page.route('**/src/weapon-assets.js*', route => route.fulfill({
    contentType: 'application/javascript', body: `export const RIFLE_PBR_ASSETS = ${JSON.stringify(config)};`,
  }));
  await page.route('**/assets/weapons/test/**', route => route.fulfill(missing
    ? { status: 404, body: 'missing test texture' }
    : { contentType: 'image/png', body: Buffer.from(pixels, 'base64') }));
  await page.goto(url);
  return { page, errors, requests };
}
try {
  const normal = await open(null);
  await normal.page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  assert.equal((await normal.page.evaluate(() => window.__battle.rifleTextures)).wood.textures.map.url, 'generated');
  assert.deepEqual(normal.requests, []);
  assert.deepEqual(normal.errors, []);
  await normal.page.close();

  const config = {
    wood: { ...fixtureSource, color: '/assets/weapons/test/wood.png', normal: '/assets/weapons/test/normal.png', roughness: '/assets/weapons/test/wood-rough.png' },
    steel: { ...fixtureSource, color: '/assets/weapons/test/steel.png', normal: '/assets/weapons/test/normal.png',
      roughness: '/assets/weapons/test/steel-mask.png', metalness: '/assets/weapons/test/steel-mask.png' },
  };
  const valid = await open(config);
  await valid.page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await valid.page.locator('#deploy').click();
  await valid.page.waitForTimeout(250);
  const textures = await valid.page.evaluate(() => window.__battle.rifleTextures);
  assert.equal(textures.wood.metalness, 0, 'optional maps never make the walnut stock metallic');
  assert.equal(textures.steel.roughness, 1);
  assert.equal(textures.steel.metalness, 1);
  assert.equal(textures.wood.textures.map.colorSpace, 'srgb');
  for (const part of ['wood', 'steel']) assert.equal(textures[part].textures.normalMap.colorSpace, '');
  assert.equal(textures.steel.textures.roughnessMap.url, '/assets/weapons/test/steel-mask.png');
  assert.equal(textures.steel.textures.metalnessMap.url, '/assets/weapons/test/steel-mask.png');
  assert.equal(valid.requests.length, 5, 'shared linear maps are loaded once, not duplicated per material channel');
  assert.deepEqual(valid.errors, []);
  await valid.page.close();

  const missing = await open({ steel: { ...fixtureSource, color: '/assets/weapons/test/missing.png' } }, true);
  await missing.page.locator('#fatal').waitFor({ state: 'visible', timeout: 60000 });
  assert.match(await missing.page.locator('#fatal-message').textContent(), /步枪材质.*steel.color.*missing.png/);
  assert.equal(await missing.page.locator('#menu').isVisible(), false);
  await missing.page.close();

  const invalid = await open({ steel: { license: 'unknown', source: 'fixture', color: '/assets/weapons/test/steel.png' } });
  await invalid.page.locator('#fatal').waitFor({ state: 'visible', timeout: 60000 });
  assert.match(await invalid.page.locator('#fatal-message').textContent(), /CC0-1.0/);
  assert.deepEqual(invalid.requests, [], 'unlicensed optional paths are rejected before fetching');
  await invalid.page.close();
  console.log('PASS: unchanged defaults, real local PBR sampling/color spaces, shared texture requests and explicit missing/unlicensed resource errors.');
} finally {
  await browser.close();
}
