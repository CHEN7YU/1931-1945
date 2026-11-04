import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.__hitEnemyAircraft = () => {
  const vehicle = [...entities.vehicles.values()].find(v => v.type === 'plane' && v.team === 'enemy' && v.health > 0);
  if (!vehicle) throw new Error('No enemy aircraft in fixture');
  damageVehicle(vehicle, vehicle.health, captureAttackSource(entities, allies[current], allies[current].mortar), 'aircraft-gun');
  return { id: vehicle.id, y: vehicle.position.y, time };
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('2');
  await page.mouse.down({ button: 'right' });
  await page.mouse.click(720, 500);
  try {
    await page.waitForFunction(() => window.__battle.mortar?.phase === 'ready', null, { timeout: 10000 });
  } catch (error) {
    throw new Error(JSON.stringify(await page.evaluate(() => ({ state: window.__battle.state, mortar: window.__battle.mortar,
      audio: window.__battle.mortarAudio, fatal: document.getElementById('fatal-message').textContent, toast: document.getElementById('toast').textContent }))));
  }
  await page.evaluate(() => {
    const data = window.__battle, objective = data.objectives.find(point => point.id === 'B');
    const heading = Math.atan2(data.position.x - objective.x, data.position.z - objective.z);
    const distance = Math.hypot(data.position.x - objective.x, data.position.z - objective.z);
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -(heading - data.look.yaw) / .0022,
      movementY: (data.mortar.distance - distance) / .5 }));
  });
  await page.mouse.click(720, 500);
  await page.waitForFunction(() => window.__battle.mortarAudio.played > 0);
  await page.waitForFunction(() => window.__battle.projectileImpacts.length > 0, null, { timeout: 20000 });
  const blast = await page.evaluate(() => ({ impact: window.__battle.projectileImpacts[0],
    audio: window.__battle.mortarAudio, explosions: window.__battle.combatEvents.history.filter(e => e.type === 'explosion') }));
  assert.equal(blast.impact.damage, 240); assert.equal(blast.impact.radius, 9);
  assert.ok(blast.explosions.some(event => event.style === 'explosive-pack'));
  assert.equal(blast.audio.loaded, true);
  const destroyed = await page.evaluate(() => window.__hitEnemyAircraft());
  await page.waitForFunction(start => {
    const vehicle = window.__battle.vehicles.find(item => item.id === start.id);
    return vehicle.fall.grounded || vehicle.position.y < start.y - 5;
  }, destroyed, { timeout: 15000 });
  const fallen = await page.evaluate(id => window.__battle.vehicles.find(item => item.id === id), destroyed.id);
  assert.ok(fallen.position.y < destroyed.y, 'destroyed aircraft must actually descend');
  await page.keyboard.press('1');
  await page.waitForFunction(t => window.__battle.time >= t + 14, destroyed.time, { timeout: 45000 });
  await page.keyboard.press('5');
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === 'cooking');
  await page.mouse.up();
  await page.waitForFunction(old => window.__battle.vehicles.some(v => v.team === 'enemy' && v.type === 'plane' &&
    v.id !== old && v.health > 0), destroyed.id, { timeout: 45000 });
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#fatal').isVisible(), false);
  const current = await page.evaluate(() => ({ time: window.__battle.time, aircraft: window.__battle.vehicles.filter(v => v.type === 'plane'),
    views: window.__battle.vehicleViews.ids, grenades: window.__battle.grenades.active.length }));
  assert.ok(current.aircraft.filter(v => v.health > 0).every(v => current.views.includes(v.id)));
  assert.deepEqual(errors, []);
  const result = { passed: true, blast, destroyed, fallen, current,
    limitation: 'Aircraft hit injected through a local fixture; falling, natural reinforcement and grenade collision are actual game paths.' };
  await writeFile(join(directory, 'mortar-aircraft.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, launchAudible: blast.audio.played > 0, damage: blast.impact.damage, radius: blast.impact.radius,
    fallenFrom: destroyed.y, fallenTo: fallen.position.y, naturalReplacementRegistered: true }));
} finally { await browser.close(); }
