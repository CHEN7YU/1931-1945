import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tankCannonPose } from '../src/player-tank.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [], directory = process.env.ARTIFACT_DIR;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
async function elapsed(seconds) {
  const started = (await snapshot()).time;
  await page.waitForFunction(({ started, seconds }) => window.__battle.time >= started + seconds, { started, seconds });
}
async function capture(stage) {
  observations.push({ stage, data: await snapshot() });
  if (directory) await page.screenshot({ path: join(directory, `${stage}.png`) });
}
async function levelView() {
  await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const data = window.__battle, sensitivity = data.controlInput.held.aiming ? .00132 : .0022;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: data.look.pitch / sensitivity }));
  });
  await page.mouse.up({ button: 'right' }); await elapsed(.2);
}
try {
  if (directory) await mkdir(directory, { recursive: true });
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.searchParams.set('benchmark', 'control'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#squad-choices [data-type="tank"]').click(); await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  let data = await snapshot();
  assert.equal(data.benchmark?.scenario, 'control', 'use the development server for this controlled fixture');
  const id = data.controlInput.owner.vehicleId;
  const vehicle = () => snapshot().then(data => data.vehicles.find(vehicle => vehicle.id === id));
  const initial = await vehicle(), primary = { ...initial.weapon }, gunId = initial.machineGuns[0].id;
  assert.equal(await page.locator('#tank-orientation').isVisible(), true);
  await page.keyboard.down('Space'); await elapsed(.65); await page.keyboard.up('Space');
  let current = await vehicle();
  assert.ok(current.machineGuns[0].shots >= 4);
  assert.ok(current.machineGuns[0].ammo < 100);
  assert.equal(current.weapon.ammo, primary.ammo);
  assert.equal(current.weapon.reloadUntil, primary.reloadUntil);
  const shots = current.machineGuns[0].shots;
  await elapsed(.3); assert.equal((await vehicle()).machineGuns[0].shots, shots);
  data = await snapshot();
  assert.ok(data.combatEvents.history.some(event => event.type === 'shot' && event.source.weaponId === gunId &&
    event.source.vehicleId === id && event.source.weaponClass === 'tank-machine-gun'));
  await page.mouse.move(720, 450); await page.mouse.down();
  await page.waitForFunction(id => Boolean(window.__battle.vehicles.find(vehicle => vehicle.id === id)?.weapon.lastShot), id);
  await page.mouse.up();
  current = await vehicle();
  const cannon = current.weapon.lastShot, muzzle = tankCannonPose(current).start;
  assert.ok(cannon, 'a real primary shot records its physical muzzle');
  assert.ok(Math.hypot(cannon.start[0] - muzzle.x, cannon.start[1] - muzzle.y, cannon.start[2] - muzzle.z) < 1e-6);
  assert.equal(current.machineGuns[0].shots, shots, 'the primary cannon does not consume machine-gun ammunition');
  await levelView(); await capture('commander-machine-gun');
  await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' });
  await page.locator('#tank-optics').waitFor({ state: 'visible' }); await capture('commander-optics');
  await page.mouse.up({ button: 'right' });
  const before = await vehicle();
  await page.keyboard.down('a'); await elapsed(.65); await page.keyboard.up('a'); await elapsed(.2);
  current = await vehicle();
  assert.ok(current.heading > before.heading + .3);
  assert.equal(current.turretYaw, before.turretYaw);
  const hull = await page.locator('#tank-hull').getAttribute('data-heading');
  assert.ok(Math.abs(Number(hull)) > 15);
  const position = { ...current.position }, heading = current.heading;
  await page.keyboard.down('w'); await elapsed(.35); await page.keyboard.up('w');
  current = await vehicle();
  const dx = current.position.x - position.x, dz = current.position.z - position.z;
  assert.ok(dx * -Math.sin(heading) + dz * -Math.cos(heading) > .3, 'W drives the hull nose, not the camera');
  await page.keyboard.press('y'); await elapsed(.3); await levelView(); await capture('gunner-view');
  await page.keyboard.press('y'); await elapsed(.3);
  data = await snapshot();
  assert.equal(data.vehicles.find(vehicle => vehicle.id === id).seats.find(seat => seat.id === data.controlInput.owner.seatId).role, 'driver');
  const driverShots = (await vehicle()).machineGuns[0].shots;
  await page.keyboard.down('Space'); await elapsed(.3); await page.keyboard.up('Space');
  assert.equal((await vehicle()).machineGuns[0].shots, driverShots, 'driver cannot operate a gun');
  await capture('driver-observation');
  await page.keyboard.press('y');
  await page.keyboard.down('Space'); await elapsed(.2); await page.keyboard.press('Escape');
  const paused = await vehicle(); await page.waitForTimeout(300);
  assert.equal((await vehicle()).machineGuns[0].shots, paused.machineGuns[0].shots);
  await page.keyboard.up('Space'); await page.locator('#resume').click(); await elapsed(.3);
  assert.equal((await vehicle()).machineGuns[0].shots, paused.machineGuns[0].shots, 'resume clears the held firing key');
  await page.keyboard.down('Tab');
  assert.equal(await page.locator('#scoreboard-stats svg').count(), 2, 'opening Tab populates its summary immediately');
  const header = page.locator('#squad-score-table thead th[aria-label="狙击枪"]').first();
  await header.waitFor();
  assert.equal(await page.locator('.score-team').count(), 2);
  assert.equal(await header.locator('svg').count(), 1);
  assert.equal((await header.innerText()).trim(), '', 'stat headers are icons, not long printed names');
  assert.equal(await page.locator('#squad-score-table thead th[aria-label="炸药包"]').count(), 2);
  assert.equal(await page.locator('#squad-score-table thead th[aria-label="坦克机枪"]').count(), 2);
  const captured = await page.evaluate(() => Boolean(document.pointerLockElement));
  await page.keyboard.press('AltLeft');
  await page.waitForFunction(() => !document.pointerLockElement);
  assert.equal((await snapshot()).state, 'playing', 'Alt scoreboard interaction does not pause the match');
  await header.hover();
  assert.equal(await header.getAttribute('title'), '狙击枪');
  await capture('squad-scoreboard'); await page.keyboard.up('Tab');
  if (captured) await page.waitForFunction(() => Boolean(document.pointerLockElement));
  url.searchParams.set('benchmark', 'full');
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#squad-choices [data-type="infantry"]').click(); await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  await elapsed(5.5); await levelView();
  await page.keyboard.down('Tab');
  await page.waitForFunction(() => document.querySelectorAll('.score-team.friendly tbody tr').length === 10);
  assert.equal(await page.locator('.score-team.enemy tbody tr').count(), 10);
  const panel = await page.locator('#scoreboard').boundingBox();
  assert.ok(panel.width > 1440 * .74 && panel.width < 1440 * .86, 'dual-team panel follows the confirmed central overlay layout');
  await capture('full-army-icon-scoreboard'); await page.keyboard.up('Tab');
  assert.deepEqual(errors, []);
  console.log('PASS: real Space automatic fire, original secondary ownership, cannon independence, hull-relative driving diagram, three seat views, optics, pause and squad scoreboard.');
} finally {
  if (directory) await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
