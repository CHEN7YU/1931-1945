import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sources = JSON.parse(await readFile(new URL('../public/assets/sources.json', import.meta.url), 'utf8'));
assert.equal(sources.license, 'CC0-1.0');
assert.equal(sources.files.length, 19);
for (const asset of sources.files) {
  const bytes = await readFile(new URL(`../public/assets/${asset.file}`, import.meta.url));
  assert.equal(createHash('md5').update(bytes).digest('hex'), asset.md5, `bundled asset checksum: ${asset.file}`);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], requests = [], loadedAssets = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('request', request => requests.push(request.url()));
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  if (response.url().includes('/assets/') && response.ok()) loadedAssets.add(new URL(response.url()).pathname);
});
const artifacts = process.env.ARTIFACT_DIR;
async function capture(name) {
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, name) });
  }
}
try {
  const url = process.env.GAME_URL || 'http://127.0.0.1:5173';
  await page.goto(url);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await capture('scene-menu.png');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  await page.waitForTimeout(1000);
  await capture('scene-after.png');
  assert.equal(loadedAssets.size, 19, 'all PBR maps and the photographic sky load before deployment');
  assert.ok(requests.every(request => !/^https?:/.test(request) || new URL(request).origin === new URL(url).origin), 'gameplay never requests third-party assets');
  await page.keyboard.down('w');
  await page.waitForTimeout(1800);
  await page.keyboard.up('w');
  await page.keyboard.down('a');
  await page.waitForTimeout(500);
  await page.keyboard.up('a');
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: -480 })));
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(250);
  await capture('scene-street.png');
  const snapshot = await page.evaluate(() => window.__battle);
  assert.equal(snapshot.state, 'playing', 'scenic street is still an actual playable battlefield');
  assert.ok(snapshot.position.z < 74, 'new street collision permits movement from the registered base');
  assert.ok(snapshot.drawCalls < 230, `batched scenery and character bodies keep draw calls bounded (${snapshot.drawCalls})`);
  assert.deepEqual(errors, [], 'no renderer, asset or runtime errors');
  const missingAssetPage = await browser.newPage();
  await missingAssetPage.route('**/assets/materials/brick/color.jpg', route => route.fulfill({ status: 404, body: 'missing asset' }));
  await missingAssetPage.goto(url);
  await missingAssetPage.locator('#fatal').waitFor({ state: 'visible' });
  assert.match(await missingAssetPage.locator('#fatal-message').textContent(), /场景材质加载失败/, 'missing assets show a real error instead of falling back to flat surfaces');
  assert.equal(await missingAssetPage.locator('#menu').isVisible(), false, 'incomplete scenes cannot be deployed');
  await missingAssetPage.close();
  console.log(`PASS: 19 local asset checksums, complete offline scene loading, real first-person captures, traversable street and ${snapshot.drawCalls} draw calls.`);
} finally {
  await browser.close();
}
