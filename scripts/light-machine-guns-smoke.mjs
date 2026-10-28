import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const wait = (predicate, arg = null) => page.waitForFunction(predicate, arg, { timeout: 120000 });
async function switchTo(index) {
  for (let step = 0; step < 11 && (await snapshot()).current !== index; step++) {
    const previous = (await snapshot()).current;
    await page.keyboard.press('y');
    await wait(previous => window.__battle.current !== previous, previous);
  }
  assert.equal((await snapshot()).current, index);
}
async function capture(name) {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
}
try {
  for (const appearance of ['native', 'procedural']) {
    console.log(`LMG: ${appearance} deployment`);
    const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
    if (appearance === 'procedural') url.searchParams.set('character', 'procedural');
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await wait(() => window.__battle?.state === 'menu');
    await page.locator('#menu-quality').selectOption('low');
    await page.locator('#deploy').click();
    await wait(() => window.__battle.state === 'playing');
    const initial = await snapshot();
    assert.equal(initial.population.friendly.alive, 110);
    assert.equal(initial.population.enemy.alive, 96);
    assert.equal(initial.entityCounts.soldiers, 206);
    assert.equal(initial.entityCounts.weapons, 206 * 3 + 2 + 4,
      'each soldier owns a primary weapon, grenade inventory and pack; tank primary and machine guns are independent');
    for (const unit of initial.population.units.filter(unit => unit.type === 'infantry')) {
      assert.equal(unit.memberCount, 11);
      assert.equal(unit.members[0].role, 'engineer');
      assert.ok(unit.members.slice(1, 9).every(actor => actor.role === 'rifleman' && actor.weaponModel === 'rifle'));
      assert.equal(unit.members[9].role, 'sniper');
      assert.equal(unit.members[9].weaponModel, 'sniper');
      assert.equal(unit.members[10].role, 'machine-gunner');
      assert.equal(unit.members[10].section, 0);
      assert.equal(unit.members[10].weaponModel, unit.team === 'friendly' ? 'zb26' : 'type11');
    }
    if (appearance === 'native') {
      await wait(() => window.__battle.historicalForce?.assigned === 110 && window.__battle.enemyHistoricalForce?.assigned === 96);
      const forces = await snapshot();
      assert.equal(forces.historicalForce.members.filter(actor => actor.weaponModel === 'zb26').length, 10);
      assert.equal(forces.enemyHistoricalForce.members.filter(actor => actor.weaponModel === 'type11').length, 8);
    }
    await switchTo(10);
    let data = await snapshot();
    const gunnerId = data.control.soldierId, weaponId = data.controlBinding.weaponId;
    assert.ok(weaponId);
    assert.ok(Math.abs(data.rifle.model.boltLift) < 1e-8);
    assert.equal(data.rifle.ammo, 20);
    assert.equal(data.rifle.model.clipVisible, false);
    assert.equal(data.allies[10].order, 'follow');
    assert.match(await page.locator('#weapon-name').textContent(), /ZB-26/);
    assert.equal(await page.locator('#ammo-max').textContent(), '/ 20');
    assert.match(await page.locator('#members .member').nth(10).getAttribute('title'), /轻机枪手/);
    await page.mouse.down({ button: 'right' });
    await wait(() => window.__battle.fov < 48.01);
    data = await snapshot();
    assert.ok(data.rifle.sights.every(point => Math.abs(point.x) < .002 && Math.abs(point.y) < .002));
    await capture(`lmg-${appearance}-aim.png`);
    const shots = data.rifle.shots;
    await page.mouse.down();
    const firingSample = await wait(shots => {
      const data = window.__battle;
      return data.rifle.shots >= shots + 6 && data.rifle.trace
        ? data.rifle : false;
    }, shots);
    const firing = await firingSample.jsonValue();
    await firingSample.dispose();
    assert.ok(Math.hypot(...firing.trace.start.map((value, index) => value - firing.muzzle[index])) < .15,
      'compare the shot origin with its firing-frame muzzle, before lowering the weapon');
    await page.mouse.up();
    await page.mouse.up({ button: 'right' });
    data = await snapshot();
    assert.ok(data.rifle.ammo <= 14, 'one held trigger spends at least six actual rounds');
    const fired = data.rifle.shots;
    await switchTo(0);
    assert.equal((await snapshot()).rifle.ammo, 5, 'the original engineer retains their own rifle');
    await switchTo(10);
    data = await snapshot();
    assert.equal(data.control.soldierId, gunnerId);
    assert.equal(data.controlBinding.weaponId, weaponId);
    assert.equal(data.rifle.shots, fired);
    assert.equal(data.rifle.ammo, 20 - fired);
    await page.keyboard.press('r');
    await wait(() => window.__battle.rifle.action === 'reload' && window.__battle.rifle.elapsed > .3);
    await page.keyboard.press('Escape');
    await wait(() => window.__battle.state === 'pause');
    const paused = await snapshot();
    await page.waitForTimeout(300);
    data = await snapshot();
    assert.equal(data.rifle.elapsed, paused.rifle.elapsed);
    assert.equal(data.rifle.ammo, paused.rifle.ammo);
    await page.locator('#resume').click();
    await wait(() => window.__battle.rifle.action === 'idle' && window.__battle.rifle.ammo === 20);
    assert.equal((await snapshot()).rifle.shots, fired);
    await capture(`lmg-${appearance}-loaded.png`);
    observations.push({ appearance, initial: initial.entityCounts, gunnerId, weaponId, fired, reloaded: (await snapshot()).rifle });
    if (appearance === 'native') {
      console.log('LMG: observing autonomous fire on both sides');
      await wait(() => ['friendly', 'enemy'].every(team => window.__battle.population.units
        .some(unit => unit.team === team && !unit.player && unit.members.some(actor => actor.role === 'machine-gunner' && actor.shots > 0))));
      observations.push({ autonomousFire: (await snapshot()).population.units.map(unit => ({
        id: unit.id, gunner: unit.members.find(actor => actor.role === 'machine-gunner'),
      })) });
    }
  }
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'light-machine-guns.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: 206 real soldiers, 18 faction-specific LMGs and two enemy tanks, native/procedural equipment, Y ownership, held automatic fire, reload/pause and autonomous fire on both sides.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ errors, state: data?.state, time: data?.time, current: data?.current, rifle: data?.rifle,
    gunners: data?.population?.units.map(unit => ({ unit: unit.id, gunner: unit.members.find(actor => actor.role === 'machine-gunner') })) }));
  throw error;
} finally {
  await browser.close();
}
