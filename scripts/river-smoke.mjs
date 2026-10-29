import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { groundHeight, riverBedHeight } from '../src/ground.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
async function load(scenario) {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', scenario);
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  if (scenario === 'ford') await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
}
async function walkTo(x, z) {
  let arrived = false;
  for (let i = 0; i < 400; i++) {
    const data = await snapshot(), dx = x - data.position.x, dz = z - data.position.z;
    assert.equal(data.state, 'playing');
    const distance = Math.hypot(dx, dz);
    if (distance < .25) { arrived = true; break; }
    await page.mouse.down({ button: 'right' });
    await page.evaluate(yaw => {
      const delta = Math.atan2(Math.sin(yaw - window.__battle.look.yaw), Math.cos(yaw - window.__battle.look.yaw));
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132 }));
    }, Math.atan2(-dx, -dz));
    await page.mouse.up({ button: 'right' });
    await page.keyboard.down('w');
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('w'); await page.waitForTimeout(300);
  assert.ok(arrived, JSON.stringify({ target: { x, z }, position: (await snapshot()).position }));
}
async function capture(name) {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
}
try {
  await load('bridge');
  const surfaces = (await snapshot()).river.surfaces;
  assert.ok(Math.abs(surfaces.bed - (riverBedHeight(-48, -16) - .035)) < .012,
    'actual rendered dry bed follows the irregular recessed terrain');
  assert.ok(surfaces.bed < surfaces.southBank && surfaces.southBank < surfaces.street);
  assert.ok(surfaces.bed < surfaces.northBank && surfaces.northBank < surfaces.street);
  await walkTo(8, -8.1); await walkTo(-48, -8.1); await walkTo(-48, -16);
  let data = await snapshot();
  assert.ok(Math.abs(data.position.y - groundHeight(data.position.x, data.position.z)) < .001);
  assert.equal(data.river.dry, true);
  assert.equal(Object.hasOwn(data.river, 'waterHeight'), false);
  assert.notEqual(await page.locator('#pace-label').textContent(), '浅水涉渡');
  observations.push({ infantry: data.position, river: data.river });
  await capture('infantry-dry-river.png');
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const delta = Math.atan2(Math.sin(Math.PI / 2 - window.__battle.look.yaw), Math.cos(Math.PI / 2 - window.__battle.look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132 }));
  });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.locomotion.speed > 4.6, null, { timeout: 5000 });
  assert.equal((await snapshot()).locomotion.sprinting, true, 'dry bed no longer imposes wading speed or disables sprint');
  await page.keyboard.up('w'); await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(300);
  await walkTo(-48, -25.5);
  assert.equal((await snapshot()).position.y, 0);
  await walkTo(-48, -16); await walkTo(-48, -8.1);
  assert.equal((await snapshot()).position.y, 0);
  await load('ford');
  const initial = await snapshot(), vehicle = initial.vehicles[0];
  assert.equal(initial.population.enemy.alive, 0);
  assert.equal(initial.type, 'tank');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z < -15.5, null, { timeout: 20000 });
  await page.keyboard.up('w');
  data = await snapshot();
  assert.ok(Math.abs(data.position.y - groundHeight(data.position.x, data.position.z)) < .001);
  assert.equal(data.vehicles[0].id, vehicle.id);
  assert.equal(data.vehicles[0].health, vehicle.health, 'the dry riverbed remains traversable by tanks');
  observations.push({ tank: data.position, dry: data.river.dry });
  await capture('tank-dry-river.png');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z < -24.5, null, { timeout: 20000 });
  await page.keyboard.up('w');
  assert.equal((await snapshot()).position.y, 0);
  await page.keyboard.down('s');
  await page.waitForFunction(() => window.__battle.position.z > -7, null, { timeout: 20000 });
  await page.keyboard.up('s');
  data = await snapshot();
  assert.equal(data.position.y, 0);
  assert.equal(data.vehicles[0].health, vehicle.health);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'river.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: irregular dry riverbed, normal infantry sprint and real tank crossing off-bridge both ways. Isolated geometry fixtures, not a population benchmark.');
} finally {
  await browser.close();
}
