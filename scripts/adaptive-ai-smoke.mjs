import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
window.__adaptiveFixture = {
  pressure(ms, seconds) {
    for (let elapsed = 0; elapsed < seconds; elapsed += ms / 1000) adaptiveAI.observeFrame(ms, true);
    return adaptiveAI.snapshot;
  },
  inspect() {
    aiDecisionView.update();
    return allForces.filter(actor => actor.health > 0 && !actor.vehicleId).map(actor => ({
      id: actor.id, x: actor.position.x, z: actor.position.z,
      interval: adaptiveAI.intervalFor('sensor', actor.position, camera.position,
        aiDecisionView.intersects(actor.position, 2), actor.target?.id === entities.control.soldierId),
      inView: aiDecisionView.intersects(actor.position, 2),
      near: actor.position.distanceTo(camera.position) <= 40,
      threats: actor.target?.id === entities.control.soldierId
    }));
  },
  turn() { camera.rotation.y += Math.PI; camera.updateMatrixWorld(true); }
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const result = await page.evaluate(() => {
    const pressure = window.__adaptiveFixture.pressure(60, 6);
    const beforeTurn = window.__adaptiveFixture.inspect();
    window.__adaptiveFixture.turn();
    const afterTurn = window.__adaptiveFixture.inspect();
    const recovered = window.__adaptiveFixture.pressure(1000 / 60, 12);
    window.__adaptiveFixture.pressure(60, 6);
    return { pressure, beforeTurn, afterTurn, recovered };
  });
  assert.equal(result.pressure.level, 2);
  assert.equal(result.recovered.level, 0);
  for (const actors of [result.beforeTurn, result.afterTurn]) {
    assert.ok(actors.some(actor => actor.interval > 0), 'real offscreen soldiers receive a cooldown');
    assert.ok(actors.filter(actor => actor.inView || actor.near || actor.threats).every(actor => actor.interval === 0));
  }
  const before = await page.evaluate(() => ({ time: window.__battle.time, scheduler: window.__battle.aiDecisions }));
  const positionsBefore = await page.evaluate(() => window.__adaptiveFixture.inspect().filter(actor => actor.interval > 0));
  await page.locator('#resume').click();
  await page.waitForFunction(time => window.__battle.time > time + 4, before.time, { timeout: 30000 });
  const after = await page.evaluate(() => ({
    time: window.__battle.time, scheduler: window.__battle.aiDecisions, adaptive: window.__battle.adaptiveAI,
    shots: window.__battle.combatStats.aiRifleShots,
  }));
  assert.ok(after.scheduler.totalServiced.sensor > before.scheduler.totalServiced.sensor);
  assert.ok(after.scheduler.deferredAttempts.sensor > before.scheduler.deferredAttempts.sensor,
    'the live loop must actually defer offscreen decisions');
  const positionsAfter = await page.evaluate(() => window.__adaptiveFixture.inspect());
  const movingOffscreen = positionsBefore.filter(before => positionsAfter.some(after =>
    after.id === before.id && Math.hypot(after.x - before.x, after.z - before.z) > .1)).length;
  assert.ok(movingOffscreen > 0, 'real offscreen soldiers must keep moving while their thinking is deferred');
  assert.match(await page.locator('#simulation-status').textContent(), /自动减负/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const paused = await page.evaluate(() => ({ time: window.__battle.time, level: window.__battle.adaptiveAI.level }));
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => ({ time: window.__battle.time, level: window.__battle.adaptiveAI.level })), paused);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'adaptive-ai.json'), JSON.stringify({ passed: true, result, before, after, movingOffscreen, paused, errors,
    fixture: 'Pressure and camera turn are controlled browser-only inputs. Actual soldiers, movement and simulation are unmodified. Not a performance benchmark or natural victory.' }, null, 2));
  console.log(JSON.stringify({ passed: true, level: result.pressure.level, restored: result.recovered.level,
    liveSimulationSeconds: after.time - before.time, deferred: after.scheduler.deferredAttempts }));
} finally { await browser.close(); }
