import { continueIdentitySelection } from './game-entry.mjs';
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
    const body = await response.text();
    await route.fulfill({ response, body: `${body}
window.__testEnemyObjectiveCapture = () => {
  for (const point of objectives) { point.owner = 'enemy'; point.control = -1; point.enemyProgress = 1; }
  updateObjectives(0);
};
window.__testExpireGrace = () => {
  const remaining = ENCIRCLEMENT_RULES.defeatGraceSeconds - encirclement.enemyControlSeconds;
  const winner = advanceEncirclement(encirclement, objectives, formations, remaining);
  if (winner) showOverlay(winner === 'enemy' ? 'defeat' : 'victory');
  updateHUD();
};
` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#redeploy-choices [data-type="tank"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  assert.equal(await page.evaluate(() => typeof window.__testEnemyObjectiveCapture), 'function',
    'the objective-only browser fixture must be installed before observing the game');
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.ammo === 0);
  await page.mouse.up();
  await page.locator('#tank-reload').waitFor({ state: 'visible' });
  const reload = await page.locator('#tank-reload').boundingBox();
  assert.ok(reload.x > 1280 * .7 && reload.y > 800 * .65);
  assert.equal(await page.locator('#tank-reload').evaluate(element => Boolean(element.closest('.weapon-status'))), true);
  await page.screenshot({ path: join(directory, 'reload-lower-right.png') });
  await page.evaluate(() => {
    window.__aircraftSamples = [];
    window.__aircraftProbe = setInterval(() => {
      const data = window.__battle;
      window.__aircraftSamples.push({ time: data.time, state: data.state,
        aircraft: data.vehicles.filter(vehicle => vehicle.team === 'enemy' && vehicle.type === 'plane')
          .map(vehicle => ({ id: vehicle.id, health: vehicle.health, position: vehicle.position,
            aiFlight: structuredClone(vehicle.aiFlight) })) });
    }, 250);
  });
  await page.waitForFunction(() => {
    const data = window.__battle;
    return data.time >= 35 || data.state === 'defeat' || data.state === 'victory' || !document.getElementById('fatal').hidden;
  }, null, { timeout: 150000 });
  const samples = await page.evaluate(() => { clearInterval(window.__aircraftProbe); return window.__aircraftSamples; });
  const aircraft = samples.flatMap(sample => sample.aircraft);
  assert.ok(aircraft.length > 5);
  assert.ok(aircraft.every(vehicle => vehicle.health > 0), 'the aircraft must not destroy itself against the fortress during observation');
  assert.ok(aircraft.some(vehicle => vehicle.aiFlight.shots > 0), 'avoiding roofs cannot replace real strafing with idle circling');
  const avoided = aircraft.filter(vehicle => vehicle.aiFlight.avoidance).length;
  await page.evaluate(() => {
    if (window.__battle.state === 'playing') window.__testEnemyObjectiveCapture();
  });
  assert.equal(await page.evaluate(() => window.__battle.state), 'playing', 'full enemy control starts a counterattack grace window');
  await page.evaluate(() => window.__testExpireGrace());
  assert.equal(await page.evaluate(() => window.__battle.state), 'defeat');
  assert.equal(await page.evaluate(() => window.__battle.objectives.filter(point => point.owner === 'enemy').length), 3);
  assert.match(await page.locator('#overlay-description').textContent(), /连续控制三个据点90秒/);
  const ended = await page.evaluate(() => window.__battle.time);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__battle.time), ended);
  assert.equal(await page.locator('#resume').isVisible(), false);
  await page.screenshot({ path: join(directory, 'three-point-defeat.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'regression.json'), JSON.stringify({ passed: true,
    observedUntil: samples.at(-1)?.time, avoidanceSamples: avoided, reload,
    defeatFixture: 'Objective ownership and the grace expiry were driven by this browser-only fixture; aircraft observation was unmodified.',
    samples, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, observedUntil: samples.at(-1)?.time, avoidanceSamples: avoided,
    enemyPlaneSurvived: true, threePointDefeat: true, reloadLowerRight: true }));
} finally {
  await browser.close();
}
