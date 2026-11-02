import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
window.__graceTest = {
  allEnemy() {
    for (const point of objectives) { point.owner = 'enemy'; point.control = -1; }
    encirclement.enemyControlSeconds = 0;
    updateObjectives(0); updateHUD();
  },
  neutralize() {
    objectives[1].owner = null; objectives[1].control = 0;
    advanceEncirclement(encirclement, objectives, formations, 0); updateHUD();
  },
  step(seconds) {
    const winner = advanceEncirclement(encirclement, objectives, formations, seconds);
    if (winner) showOverlay(winner === 'enemy' ? 'defeat' : 'victory');
    updateHUD();
    return { state, seconds: encirclement.enemyControlSeconds };
  }
};
` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  const started = await page.evaluate(() => {
    window.__graceTest.allEnemy();
    return { state: window.__battle.state, warning: document.getElementById('encirclement-warning').textContent,
      visible: !document.getElementById('encirclement-warning').hidden };
  });
  assert.equal(started.state, 'playing'); assert.equal(started.visible, true); assert.match(started.warning, /90秒/);
  await page.screenshot({ path: join(directory, 'counterattack-warning.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const frozen = await page.evaluate(() => window.__battle.encirclement.enemyControlSeconds);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__battle.encirclement.enemyControlSeconds), frozen);
  const result = await page.evaluate(() => {
    window.__graceTest.allEnemy();
    const early = window.__graceTest.step(80);
    window.__graceTest.neutralize();
    const cleared = window.__battle.encirclement.enemyControlSeconds;
    window.__graceTest.allEnemy();
    const nearExpiry = window.__graceTest.step(89);
    const ended = window.__graceTest.step(1);
    return { early, cleared, nearExpiry, ended };
  });
  assert.equal(result.early.state, 'pause'); assert.equal(result.cleared, 0);
  assert.equal(result.nearExpiry.state, 'pause'); assert.equal(result.ended.state, 'defeat');
  assert.match(await page.locator('#overlay-description').textContent(), /反夺宽限耗尽/);
  assert.equal(await page.locator('#encirclement-warning').isVisible(), false);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'counterattack-grace.json'), JSON.stringify({
    passed: true, started, result, errors,
    fixture: 'Objective ownership and elapsed grace were controlled only in this browser fixture, without altering health, troop counts or production code. This is not a natural battle result.',
  }, null, 2));
  console.log(JSON.stringify({ passed: true, graceSeconds: 90, pauseFrozen: true, neutralizationResets: true, expiresExactly: true }));
} finally {
  await browser.close();
}
