import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { PREVIEW_OBJECTIVES } from '../src/town-preview-layout.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', error => errors.push(error.message));
  for (const type of ['infantry', 'tank', 'plane', 'infantry']) {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#menu').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#campaign-choice').inputValue(), 'taierzhuang-fort');
    await page.locator('#confirm-campaign').click();
    await page.locator(`#redeploy-choices [data-type="${type}"]`).click();
    await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
    await page.locator('#confirm-deploy').click();
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
    await page.keyboard.press('Escape');
    await page.locator('#pause-settings > summary').click();
    await page.locator('#qualityToggle').selectOption('low');
    await page.locator('#pause-settings > summary').click();
    const snapshot = await page.evaluate(() => window.__battle);
    assert.equal(snapshot.population.friendly.rosterUnits, 4);
    assert.equal(snapshot.population.friendly.alive, 44);
    assert.equal(snapshot.population.enemy.alive, 96);
    assert.equal(snapshot.population.enemy.vehicles, 2);
    assert.equal(snapshot.population.units.filter(unit => unit.team === 'enemy' && unit.type === 'plane').length, 1);
    if (type === 'infantry') assert.equal(snapshot.allies[0].role, 'mortarman');
    assert.ok(snapshot.vehicles.find(vehicle => vehicle.team === 'enemy' && vehicle.type === 'plane').aiFlight);
    if (type === 'plane') assert.ok(snapshot.vehicles.find(vehicle => vehicle.team === 'friendly' && vehicle.type === 'plane').flightControl);
    assert.equal(snapshot.encirclement.phase, 1);
    assert.equal(snapshot.encirclement.captures, 0);
    assert.deepEqual(snapshot.encirclement.unlocked, []);
    assert.deepEqual(snapshot.encirclement.disabledEnemySpawns, []);
    assert.deepEqual(snapshot.objectives.map(({ id, x, z, radius }) => ({ id, x, z, radius })),
      PREVIEW_OBJECTIVES.map(({ id, x, z, radius }) => ({ id, x, z, radius })));
    assert.ok(snapshot.population.units.filter(unit => !unit.active).every(unit => !unit.memberCount));
    assert.equal(snapshot.spawnPoints.filter(point => point.permanent).length, 0);
    assert.equal(snapshot.spawnPoints.filter(point => point.team === 'enemy' && point.enabled).length, 10);
    if (type === 'infantry') {
      await page.locator('#resume').click();
      await page.waitForFunction(() => window.__battle.time > 3, null, { timeout: 30000 });
      await page.keyboard.press('Escape');
      assert.match(await page.locator('#objective-help').textContent(), /敌后重生点/);
    }
    await page.locator('#back-menu').click();
    await page.waitForFunction(() => window.__battle?.state === 'menu');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: fortress objectives, four-squad starts for every player type, live simulation and clean match restarts.');
} finally {
  await browser.close();
}
