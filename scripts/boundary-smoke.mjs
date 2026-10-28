import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
let stage = 'loading';
const watchdog = setTimeout(() => { console.error(`Boundary check timed out at ${stage}`); void browser.close(); }, 180000);
async function turnTo(yaw, pitch = 0) {
  await page.mouse.down({ button: 'right' });
  await page.evaluate(({ yaw, pitch }) => {
    const look = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - look.pitch) / .00132 }));
  }, { yaw, pitch });
  await page.mouse.up({ button: 'right' });
}
async function walkTo(x, z) {
  await page.keyboard.down('w');
  for (let i = 0; i < 250; i++) {
    const data = await snapshot();
    assert.equal(data.state, 'playing', stage);
    const dx = x - data.position.x, dz = z - data.position.z, distance = Math.hypot(dx, dz);
    if (distance < .4) break;
    await turnTo(Math.atan2(-dx, -dz));
    await page.waitForTimeout(Math.min(100, Math.max(20, distance / 3.15 * 250)));
  }
  await page.keyboard.up('w');
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < .7,
    `normal movement reaches (${x}, ${z}); actual ${JSON.stringify(data.position)}`);
}
async function photograph(name) {
  if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
}
try {
  if (process.env.ARTIFACT_DIR) await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'interior'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  let data = await snapshot();
  assert.equal(data.outskirts.buildings, 148);
  assert.equal(data.outskirts.nearBuildings, 16);
  assert.equal(data.outskirts.hills.length, 3);
  assert.equal(data.town.buildings.length, 25);
  assert.equal(data.staticDamage.craters.length, 5);
  assert.equal(data.staticDamage.ruinedShops.length, 3);
  assert.equal(data.staticDamage.wrecks.length, 3);
  stage = 'approaching the actual southern edge';
  await walkTo(20, 78);
  await walkTo(20, 94);
  await turnTo(Math.PI * .75, .02);
  await photograph('southwest-outskirts.png');
  assert.equal((await snapshot()).boundary.outside, false);
  assert.equal(await page.locator('#boundary-warning').isVisible(), false);
  stage = 'warning before damage';
  await walkTo(20, 98);
  data = await snapshot();
  assert.equal(data.boundary.outside, true);
  assert.equal(data.boundary.damaging, false);
  assert.equal(data.health, 100);
  assert.equal(await page.locator('#boundary-warning').isVisible(), true);
  assert.match(await page.locator('#boundary-detail').innerText(), /向北返回/);
  observations.push({ stage, data: { position: data.position, boundary: data.boundary, health: data.health } });
  await photograph('boundary-warning.png');
  stage = 'paused countdown';
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  assert.equal(paused.state, 'pause');
  await page.waitForTimeout(1000);
  data = await snapshot();
  assert.equal(data.time, paused.time);
  assert.deepEqual(data.boundary, paused.boundary);
  assert.equal(data.health, paused.health);
  await page.locator('#resume').click();
  stage = 'real health attrition after grace';
  await page.waitForFunction(() => window.__battle.boundary.outsideSeconds >= 9.2, null, { timeout: 30000 });
  data = await snapshot();
  assert.equal(data.boundary.damaging, true);
  assert.ok(data.health < 90 && data.health > 65);
  assert.ok(Math.abs((100 - data.health) - (data.boundary.outsideSeconds - 8) * 10) < .001);
  assert.ok(data.combatEvents.history.some(event => event.type === 'damage' && event.source.cause === 'boundary'));
  assert.equal(data.kills, 0);
  observations.push({ stage, data: { boundary: data.boundary, health: data.health, control: data.control } });
  await photograph('boundary-damage.png');
  stage = 'returning stops damage and clears warning';
  await walkTo(20, 94);
  const returned = await snapshot();
  assert.equal(returned.boundary.outside, false);
  assert.equal(returned.boundary.outsideSeconds, 0);
  assert.equal(returned.boundary.remaining, 8);
  assert.equal(await page.locator('#boundary-warning').isVisible(), false);
  await page.waitForTimeout(1200);
  assert.equal((await snapshot()).health, returned.health);
  stage = 'fresh grace period and environmental casualty';
  await walkTo(20, 98);
  data = await snapshot();
  assert.equal(data.boundary.damaging, false);
  assert.equal(data.health, returned.health);
  const ownerId = data.control.soldierId;
  await page.waitForFunction(id => window.__battle.combatEvents.history.some(event =>
    event.type === 'casualty' && event.target.id === id && event.source.cause === 'boundary'), ownerId, { timeout: 40000 });
  data = await snapshot();
  assert.ok(data.deathTransfer.active || data.control.soldierId !== ownerId || data.state === 'dead');
  assert.equal(data.kills, 0);
  observations.push({ stage, control: data.control, deathTransfer: data.deathTransfer });
  stage = 'new battle resets boundary state';
  if (data.state !== 'dead') {
    await page.waitForFunction(() => window.__battle.state === 'playing' || window.__battle.state === 'dead');
    if ((await snapshot()).state === 'playing') await page.keyboard.press('Escape');
  }
  await page.locator('#back-menu').click();
  await page.locator('#deploy').click();
  data = await snapshot();
  assert.equal(data.health, 100);
  assert.equal(data.boundary.outside, false);
  assert.equal(data.boundary.outsideSeconds, 0);
  assert.equal(await page.locator('#boundary-warning').isVisible(), false);
  await turnTo(Math.PI / 2, -.02);
  await photograph('west-outskirts.png');
  stage = 'larger aircraft area and actual southwest hill view';
  url.searchParams.set('benchmark', 'full');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#squad-choices [data-type="plane"]').click();
  await page.locator('#deploy').click();
  await turnTo(2.12, -.025);
  await page.waitForTimeout(150);
  data = await snapshot();
  assert.equal(data.type, 'plane');
  assert.equal(data.health, 180);
  assert.equal(data.boundary.outside, false, 'the registered air deployment is not in the ground warning strip');
  await photograph('southwest-hills-flight.png');
  await turnTo(0, 0);
  stage = 'aircraft warning and gradual vehicle damage';
  await page.waitForFunction(() => window.__battle.boundary.outsideSeconds >= 9, null, { timeout: 60000 });
  data = await snapshot();
  assert.equal(data.state, 'playing');
  assert.equal(data.boundary.damaging, true);
  assert.ok(Math.abs((180 - data.health) - (data.boundary.outsideSeconds - 8) * 10) < .001);
  assert.ok(data.health > 140, 'crossing the larger flight limit does not instantly destroy the aircraft');
  assert.ok(data.combatEvents.history.some(event => event.type === 'damage' &&
    event.target.kind === 'vehicle' && event.source.cause === 'boundary'));
  observations.push({ stage, health: data.health, position: data.position, boundary: data.boundary });
  await turnTo(Math.PI, 0);
  stage = 'aircraft can return before attrition destroys it';
  await page.waitForFunction(() => window.__battle.state === 'playing' && !window.__battle.boundary.outside,
    null, { timeout: 40000 });
  data = await snapshot();
  assert.ok(data.health > 0);
  const aircraftHealth = data.health;
  await page.waitForTimeout(700);
  assert.equal((await snapshot()).health, aircraftHealth);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'boundary-observations.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: actual edge walk, warning/direction, pause freeze, grace, environmental damage, return/reset, casualty transfer, fresh battle, preserved town damage, southwest hill view and real aircraft boundary attrition/return.');
} catch (error) {
  console.error(JSON.stringify({ stage, snapshot: await snapshot(), errors }));
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
