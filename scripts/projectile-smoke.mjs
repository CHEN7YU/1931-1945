import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(15000);
const errors = [], observations = [];
let stage = 'loading';
const watchdog = setTimeout(() => { console.error(`Projectile regression timed out at ${stage}`); void browser.close(); }, 90000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
async function aim(pitch) {
  await page.mouse.down({ button: 'right' });
  await page.evaluate(pitch => document.dispatchEvent(new MouseEvent('mousemove', {
    movementY: -(pitch - window.__battle.look.pitch) / .00132,
  })), pitch);
  await page.mouse.up({ button: 'right' });
}
async function fire() {
  const count = (await snapshot()).projectileImpacts.length;
  await page.mouse.down();
  await page.waitForFunction(count => window.__battle.projectiles.length || window.__battle.projectileImpacts.length > count, count);
  await page.mouse.up();
  return (await snapshot()).projectiles[0];
}
async function aimAtBuilding(building) {
  await page.mouse.down({ button: 'right' });
  await page.evaluate(building => {
    const data = window.__battle;
    const yaw = Math.atan2(data.position.x - building.x, data.position.z - building.z);
    const delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
    const pitch = -Math.atan2(data.locomotion.cameraHeight, Math.hypot(data.position.x - building.x, data.position.z - building.z));
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: -delta / .00132, movementY: -(pitch - data.look.pitch) / .00132,
    }));
  }, building);
  await page.mouse.up({ button: 'right' });
  const before = (await snapshot()).time;
  await page.waitForFunction(time => window.__battle.time > time + .15, before);
}
async function menu() {
  if (['playing', 'transferring'].includes((await snapshot()).state)) await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  const data = await snapshot();
  assert.deepEqual(data.projectiles, []);
  assert.deepEqual(data.projectileImpacts, []);
  assert.equal(data.projectileViews, 0);
  assert.equal(data.projectileSceneObjects, 0);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#squad-choices [data-type="mortar"]').click();
  await page.locator('#deploy').click();
  await aim(0);
  stage = 'flight across manual takeover and pause';
  const original = await snapshot(), launched = await fire();
  assert.ok(launched, 'the real mortar creates an in-flight simulation entity');
  assert.equal(launched.source.soldierId, original.control.soldierId);
  assert.equal(launched.source.weaponId, original.controlInput.owner.weaponId);
  assert.equal(launched.source.credit, 'player');
  await page.keyboard.press('y');
  let data = await snapshot();
  assert.notEqual(data.control.soldierId, launched.source.soldierId);
  assert.deepEqual(data.projectiles[0].source, launched.source);
  assert.equal(data.projectileViews, data.projectiles.length);
  assert.equal(data.projectileSceneObjects, data.projectiles.length);
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(250);
  assert.deepEqual((await snapshot()).projectiles, paused.projectiles, 'pause freezes simulation rather than merely hiding a moving mesh');
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__battle.projectileImpacts.length === 1);
  data = await snapshot();
  assert.deepEqual(data.projectileImpacts[0].source, launched.source, 'impact keeps the actual original soldier and weapon after Y');
  assert.ok(data.combatEvents.history.some(event => event.type === 'explosion' &&
    event.source.soldierId === launched.source.soldierId && event.source.weaponId === launched.source.weaponId),
  'delayed explosion presentation retains the original source after control changes');
  assert.equal(data.projectiles.length, 0);
  assert.equal(data.projectileViews, 0);
  assert.equal(data.projectileSceneObjects, 0);
  observations.push({ stage, launched, impact: data.projectileImpacts[0], controlAtImpact: data.control });

  stage = 'real blast casualties retain the original firing member';
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__battle.ammo === 1);
  await aim(-1.24);
  const close = await fire();
  assert.ok(close);
  await page.keyboard.press('y');
  await page.waitForFunction(() => window.__battle.projectileImpacts.length === 2);
  data = await snapshot();
  assert.equal(data.projectileImpacts[1].source.soldierId, close.source.soldierId);
  const casualties = data.allies.filter(actor => actor.health <= 0);
  assert.ok(casualties.length > 0, 'a real close mortar impact causes ordinary blast damage, not a test damage hook');
  assert.ok(['transferring', 'dead'].includes(data.state));
  assert.ok(casualties.some(actor => actor.deathSource?.soldierId === close.source.soldierId));
  assert.ok(casualties.some(actor => actor.deathSource?.weaponId === close.source.weaponId));
  observations.push({ stage, impact: data.projectileImpacts[1], casualties, state: data.state });
  stage = 'same-battle redeployment releases the old support weapon but preserves its fired-shell history';
  await page.waitForFunction(() => window.__battle.state === 'dead');
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  data = await snapshot();
  assert.equal(data.type, 'infantry');
  assert.equal(data.entityCounts.weapons, data.entityCounts.soldiers * 3 + data.entityCounts.vehicles,
    'only personal rifles, grenade inventories and vehicle weapons remain after replacing the mortar squad');
  assert.equal(data.projectileImpacts[1].source.weaponId, close.source.weaponId,
    'retiring a weapon registry entry does not rewrite its existing attack source');
  observations.push({ stage, counts: data.entityCounts, impact: data.projectileImpacts[1] });
  await menu();

  stage = 'actual building collision, not only arrival at a ground marker';
  await page.locator('#squad-choices [data-type="mortar"]').click();
  await page.locator('#deploy').click();
  data = await snapshot();
  const building = [...data.town.buildings].sort((a, b) =>
    Math.hypot(a.x - data.position.x, a.z - data.position.z) - Math.hypot(b.x - data.position.x, b.z - data.position.z))[0];
  await aimAtBuilding(building);
  const buildingShot = await fire();
  assert.ok(Math.abs(buildingShot.target.x - building.x) < building.w / 2);
  assert.ok(Math.abs(buildingShot.target.z - building.z) < building.d / 2);
  await page.waitForFunction(() => window.__battle.projectileImpacts.length === 1);
  data = await snapshot();
  assert.equal(data.projectileImpacts[0].collided, true);
  assert.ok(data.projectileImpacts[0].position.y > buildingShot.target.y + .5, 'the shell hits real building geometry before its ground target');
  assert.equal(data.projectileViews, 0);
  assert.equal(data.projectileSceneObjects, 0);
  observations.push({ stage, building, launched: buildingShot, impact: data.projectileImpacts[0] });
  await menu();

  stage = 'new match clears active shells and their render views';
  await page.locator('#deploy').click();
  await aim(0);
  await fire();
  assert.equal((await snapshot()).projectileViews, 1);
  await menu();
  await page.locator('#deploy').click();
  data = await snapshot();
  assert.deepEqual(data.projectiles, []);
  assert.deepEqual(data.projectileImpacts, []);
  assert.equal(data.projectileViews, 0);
  assert.equal(data.projectileSceneObjects, 0);
  const before = data.time;
  await page.waitForFunction(time => window.__battle.time > time + 5, before);
  assert.deepEqual((await snapshot()).projectileImpacts, [], 'cancelled old shells cannot explode in a new battle');
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'projectile-observations.json'), JSON.stringify(observations, null, 2));
  }
  console.log('PASS: actual mortar flight, original soldier/weapon credit across Y, pause freeze, real blast casualty source, building collision, one impact, render removal and new-match cleanup.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ stage, state: data?.state, control: data?.control, projectiles: data?.projectiles,
    impacts: data?.projectileImpacts, allies: data?.allies, errors }));
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
