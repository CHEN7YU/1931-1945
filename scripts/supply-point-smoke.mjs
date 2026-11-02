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
window.__supplyTest = {
  read() {
    const point = objectives.find(point => point.id === 'A');
    return {
      friendly: battleSummary('friendly'), enemy: battleSummary('enemy'),
      supply: { ...encirclement }, owner: point.owner,
      guards: formations.filter(unit => unit.supplyGarrison).map(unit => ({
        id: unit.id, fixedObjectiveId: unit.fixedObjectiveId, blockedReason: unit.blockedReason,
        positions: unit.members.map(actor => actor.position.toArray())
      })),
      playerInside: allies[current] ? objectiveContainsPosition(point, allies[current].position) : null,
      outside: objectiveContainsPosition(point, { x: point.captureArea.minX - .1, y: 0, z: point.z }),
      upstairs: objectiveContainsPosition(point, { x: point.x, y: 3.2, z: point.z }),
      rooftop: objectiveContainsPosition(point, { x: point.x, y: 12.8, z: point.z })
    };
  },
  clock(value) { time = value; updateObjectives(0); updateHUD(); },
  supply(owner) {
    const point = objectives.find(point => point.id === 'A');
    if (owner === 'friendly') {
      const result = captureEncirclement(encirclement, formations, 'A', time);
      if (result.spawn) spawnPoints.push(result.spawn);
    }
    point.owner = owner; point.control = owner === 'friendly' ? 1 : -1;
    updateObjectives(0); updateHUD();
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
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing',
    JSON.stringify({ errors, initial: await page.evaluate(() => window.__supplyTest.read()) }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const initial = await page.evaluate(() => window.__supplyTest.read());
  assert.equal(initial.friendly.alive, 66); assert.equal(initial.enemy.alive, 71);
  assert.equal(initial.owner, 'enemy'); assert.equal(initial.guards.length, 2);
  assert.ok(initial.guards.every(unit => unit.positions.length === 11 && unit.fixedObjectiveId === 'A'));
  for (const unit of initial.guards) for (const [x, y, z] of unit.positions) {
    assert.ok(x > -43.4 && x < -28.6 && z > 6.6 && z < 17.4 && y >= -.05 && y < 12.6);
  }
  assert.equal(initial.playerInside, false);
  assert.equal(initial.outside, false); assert.equal(initial.upstairs, true); assert.equal(initial.rooftop, false);
  await page.evaluate(() => window.__supplyTest.clock(44.99));
  assert.equal(await page.evaluate(() => window.__supplyTest.read().friendly.rosterUnits), 6);
  const waves = [];
  for (const [time, squads, people] of [[45, 8, 88], [90, 10, 110], [135, 10, 110]]) {
    await page.evaluate(time => window.__supplyTest.clock(time), time);
    const snapshot = await page.evaluate(() => window.__supplyTest.read());
    assert.equal(snapshot.friendly.rosterUnits, squads);
    assert.equal(snapshot.friendly.alive, people, 'dispatched reinforcements must actually register and spawn their soldiers');
    assert.equal(snapshot.enemy.alive, initial.enemy.alive);
    waves.push(snapshot);
  }
  await page.evaluate(() => window.__supplyTest.supply('friendly'));
  const cut = await page.evaluate(() => window.__supplyTest.read());
  assert.equal(cut.supply.supplyInterrupted, true);
  assert.equal(cut.friendly.alive, 110); assert.equal(cut.enemy.alive, initial.enemy.alive);
  assert.match(await page.locator('#objective-help').textContent(), /A补给已切断.*35秒/);
  await page.evaluate(() => window.__supplyTest.supply('enemy'));
  const restored = await page.evaluate(() => window.__supplyTest.read());
  assert.equal(restored.supply.supplyInterrupted, false);
  assert.match(await page.locator('#objective-help').textContent(), /A补给正常.*17秒/);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'supply-point.json'), JSON.stringify({
    passed: true, initial, waves, cut, restored, errors,
    fixture: 'Initial guards are real game spawns. Only supply ownership and the support clock were advanced by this browser-only fixture; no health, positions or combat thresholds were changed. This is not a natural battle completion.',
  }, null, 2));
  console.log(JSON.stringify({ passed: true, initialGuards: 22, indoorOnly: true,
    realWaveStrengths: waves.map(wave => wave.friendly.alive), supplyRestored: true }));
} finally {
  await browser.close();
}
