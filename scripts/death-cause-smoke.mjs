import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/src/main.js*', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: await response.text() + `
    window.deathCauseFixture = {
      hit() {
        hurt(controlledSoldier(entities), 1000, { credit: 'enemy', team: 'enemy',
          unitId: 'test-enemy', soldierId: 'test-soldier', weaponId: 'test-weapon',
          weaponClass: 'grenade-discharger', squadId: 'test-squad', unitName: '日军小队' },
          'grenade-discharger');
      },
      finishSquad() {
        const selected = controlledSoldier(entities);
        for (const actor of allies.filter(actor => actor !== selected && actor.health > 0))
          hurt(actor, 1000, { credit: 'environment', cause: 'fall', subjectId: actor.id }, 'fall');
        hurt(selected, 1000, { credit: 'environment', cause: 'fall', subjectId: selected.id }, 'fall');
      },
      bombVehicle() {
        const vehicle = occupiedVehicle(entities, controlledSoldier(entities));
        if (!vehicle) throw new Error('The controlled soldier must be in a vehicle');
        explode(vehicle.position.clone().add(new THREE.Vector3(0, 1, 1)), 1000, 17,
          { credit: 'enemy', team: 'enemy', unitId: 'test-unit', soldierId: 'test-pilot', weaponId: 'test-bomb',
            weaponClass: 'plane', squadId: 'test-aircrew', unitName: '日军航空队', vehicleId: 'test-plane' }, 'aircraft-bomb');
      },
    };` });
});
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'bridge');
  url.searchParams.set('seed', '1938');
  if (process.env.BOMB_VEHICLE_ONLY !== '1') {
    await page.goto(url.href);
    await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
    await page.locator('#deploy').click();
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 60000 });
    await page.evaluate(() => window.deathCauseFixture.hit());
    assert.equal((await page.evaluate(() => window.__battle.dying))?.reason, '日军·八九式掷弹筒');
    await page.waitForFunction(() => window.__battle?.state === 'transferring', null, { timeout: 90000 });
    assert.equal(await page.locator('#death-transfer-reason').textContent(), '阵亡原因：日军·八九式掷弹筒');
    assert.equal(await page.locator('#death-transfer-reason').isVisible(), true);
    assert.equal(await page.locator('#death-transfer-name').isVisible(), false);
    await page.waitForFunction(() => window.__battle?.deathTransfer.active &&
      window.__battle.deathTransfer.elapsed >= 1 && !document.getElementById('death-transfer-name').hidden,
    null, { timeout: 30000 });
    assert.equal(await page.locator('#death-transfer-reason').isVisible(), false);
    assert.ok(await page.locator('#death-transfer-name').textContent());
    await page.waitForFunction(() => window.__battle?.state === 'playing' && !window.__battle.deathTransfer.active,
      null, { timeout: 90000 });
    await page.evaluate(() => window.deathCauseFixture.finishSquad());
    await page.waitForFunction(() => !document.getElementById('deployment-death-reason').hidden,
      null, { timeout: 90000 });
    assert.equal(await page.locator('#deployment-death-reason').textContent(), '阵亡原因：高处坠落');
  }
  url.searchParams.set('benchmark', 'control');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => window.deathCauseFixture.bombVehicle());
  await page.waitForFunction(() => window.__battle?.state === 'transferring', null, { timeout: 90000 });
  assert.equal(await page.locator('#death-transfer-reason').textContent(), '阵亡原因：载具被毁 · 日军·航空炸弹');
  await page.waitForFunction(() => !document.getElementById('deployment-death-reason').hidden,
    null, { timeout: 90000 });
  assert.equal(await page.locator('#deployment-death-reason').textContent(), '阵亡原因：载具被毁 · 日军·航空炸弹');
  assert.deepEqual(errors, []);
  console.log(process.env.BOMB_VEHICLE_ONLY === '1'
    ? 'PASS: vehicle bomb cause follows the real damage and transfer paths.'
    : 'PASS: discharger, fall and vehicle bomb causes follow the real damage and transfer paths.');
} finally {
  await browser.close();
}
