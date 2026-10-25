import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { QUALITY_EFFECTS } from '../src/quality.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const capture = async name => {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
};
const matchState = data => ({ time: data.time, remaining: data.remaining, squadId: data.squadId, current: data.current, ammo: data.ammo,
  health: data.health, deployments: data.deployments, position: data.position, objectives: data.objectives, motion: data.locomotion.motionStrength });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu' && window.__battle.drawCalls > 0, null, { timeout: 60000 });
  let data = await snapshot();
  assert.equal(data.graphics.pixelRatio, 1.6);
  assert.equal(data.graphics.canvasWidth, 2304, 'high profile caps actual retina drawing buffer at 1.6x');
  await page.locator('#menu-quality').selectOption('low');
  await page.waitForFunction(() => window.__battle.graphics.shadowMapWidth === 1024);
  data = await snapshot();
  assert.equal(data.graphics.canvasWidth, 1440);
  assert.equal(data.graphics.visibleSmoke, 10);
  assert.equal(data.graphics.postProcessing, false, 'no fake enabled postprocessing toggle before a pipeline exists');
  await page.setViewportSize({ width: 1280, height: 720 });
  await settled();
  const deployBox = await page.locator('#deploy').boundingBox();
  assert.ok(deployBox.y >= 0 && deployBox.y + deployBox.height <= 720, 'menu quality controls leave deployment usable at 720p');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.fov > 71.95);
  await capture('quality-low.png');
  await page.keyboard.press('Escape');
  await page.locator('#motion-strength').selectOption('0.35');
  await settled();
  const battle = matchState(await snapshot());
  await page.locator('#qualityToggle').selectOption('high');
  await page.waitForFunction(() => window.__battle.graphics.shadowMapWidth === 4096);
  await settled();
  const textureCount = (await snapshot()).graphics.textureCount;
  for (let i = 0; i < 3; i++) {
    await page.locator('#qualityToggle').selectOption('low');
    await page.waitForFunction(() => window.__battle.graphics.shadowMapWidth === 1024);
    await page.locator('#qualityToggle').selectOption('high');
    await page.waitForFunction(() => window.__battle.graphics.shadowMapWidth === 4096);
  }
  await settled();
  assert.equal((await snapshot()).graphics.textureCount, textureCount, 'shadow render targets are disposed, not leaked on repeated switching');
  for (const effect of QUALITY_EFFECTS) await page.locator(`#quality-${effect}`).uncheck();
  await settled();
  data = await snapshot();
  assert.equal(data.graphics.shadowMapWidth, 0);
  assert.equal(data.graphics.shadowsEnabled, false);
  assert.equal(data.graphics.fogEnabled, false);
  assert.equal(data.graphics.visibleSmoke, 0);
  assert.equal(await page.locator('.grain').isVisible(), false);
  await page.locator('#qualityToggle').selectOption('low');
  assert.ok(Object.values((await snapshot()).graphics.effects).every(enabled => !enabled), 'preset switches retain independent effect choices');
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForFunction(() => window.__battle.graphics.canvasWidth === 1200 && window.__battle.graphics.canvasHeight === 800);
  assert.deepEqual(matchState(await snapshot()), battle, 'graphics changes and viewport resize never reset or advance a paused battle');
  for (const effect of QUALITY_EFFECTS) await page.locator(`#quality-${effect}`).check();
  await page.waitForFunction(() => window.__battle.graphics.shadowMapWidth === 1024);
  await page.locator('#qualityToggle').selectOption('high');
  await page.waitForFunction(() => window.__battle.graphics.canvasWidth === 1920 && window.__battle.graphics.canvasHeight === 1280);
  assert.equal((await snapshot()).graphics.visibleSmoke, 30);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => window.__battle.graphics.canvasWidth === 2304 && window.__battle.graphics.canvasHeight === 1440);
  await page.locator('#resume').click();
  await page.waitForFunction(time => window.__battle.time > time + .1, battle.time);
  await capture('quality-high.png');
  assert.equal((await snapshot()).state, 'playing');
  assert.deepEqual(errors, []);
  console.log('PASS: real high/low DPR and shadow targets, smoke budgets, independent effects, no texture leaks, resize and unchanged battle state.');
} finally {
  await browser.close();
}
