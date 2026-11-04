import { deployFromMenu } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { preview } from 'vite';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let production;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}?benchmark=duel&seed=1938`);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await deployFromMenu(page);
  const first = await page.evaluate(() => window.__battle.spawnEvents);
  assert.equal(first.length, 10);
  assert.ok(first.every(event => event.pointId.startsWith('diagnostic-')));
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click(); await deployFromMenu(page);
  assert.deepEqual(await page.evaluate(() => window.__battle.spawnEvents), first, 'new diagnostic battles reset stable IDs, spawn selection and seed');
  await page.waitForFunction(() => window.__battleTelemetry.totalFrames > 2);
  const timing = await page.evaluate(() => window.__battleTelemetry);
  assert.ok(timing.frames.every(frame => frame.friendlyAlive <= 5 && frame.enemyAlive <= 5));
  assert.equal(await page.evaluate(() => window.__battle.renderIsolation.requested), 'normal');
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}?renderIsolation=no-draw&renderIsolationAt=0`);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__battle.benchmark), null);
  assert.equal(await page.evaluate(() => window.__battle.renderIsolation.requested), 'normal');
  await page.waitForFunction(() => window.__battle.drawCalls > 0);
  await page.close();
  production = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const address = production.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const built = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  built.on('pageerror', error => errors.push(error.message));
  for (const scenario of ['duel', 'interior']) {
    await built.goto(`http://127.0.0.1:${address.port}/?benchmark=${scenario}&seed=1938&queryStats=1&renderIsolation=${scenario === 'duel' ? 'no-characters' : 'no-draw'}&renderIsolationAt=0`);
    await built.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
    assert.equal(await built.evaluate(() => window.__battle.benchmark), null);
    assert.equal(await built.evaluate(() => typeof window.__battleTelemetry), 'undefined');
    assert.equal(await built.evaluate(() => typeof window.__renderTimingProbe), 'undefined');
    assert.equal(await built.evaluate(() => window.__battle.queryDiagnostics), null);
    assert.equal(await built.evaluate(() => window.__battle.renderIsolation.requested), 'normal');
    assert.equal(await built.evaluate(() => window.__battle.renderIsolation.visibleNativeRoots), 2);
    await deployFromMenu(built);
    const state = await built.evaluate(() => window.__battle.population);
    assert.equal(state.friendly.alive, 110);
    assert.equal(state.enemy.alive, 96);
    assert.equal(state.units.length, 20, 'a production URL cannot silently lower the real roster to a diagnostic fixture');
    await built.waitForFunction(() => window.__battle.drawCalls > 0);
  }
  await built.close();
  assert.deepEqual(errors, []);
  console.log('PASS: repeatable development 5v5 and raw telemetry; ordinary development URLs and production ignore render isolation, and production retains 206 people, both native character roots and actual world drawing.');
} finally {
  await browser.close();
  if (production) await new Promise((resolve, reject) => production.httpServer.close(error => error ? reject(error) : resolve()));
}
