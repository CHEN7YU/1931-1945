import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tankMachineGunPose } from '../src/player-tank.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: directory, size: { width: 1280, height: 800 } } });
const page = await context.newPage(), observations = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
let vehicleId;
const vehicle = data => data.vehicles.find(item => item.id === vehicleId);
async function elapsed(seconds) {
  const start = (await snapshot()).time;
  await page.waitForFunction(({ start, seconds }) => window.__battle.time >= start + seconds, { start, seconds });
}
async function aimAt(x, y, z) {
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'right' });
  for (let pass = 0; pass < 3; pass++) {
    await page.evaluate(({ x, y, z }) => {
      const state = window.__battle, eye = state.tankObservation.eye;
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const delta = Math.atan2(Math.sin(yaw - state.look.yaw), Math.cos(yaw - state.look.yaw));
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132,
        movementY: -(pitch - state.look.pitch) / .00132 }));
    }, { x, y, z });
    await elapsed(.06);
  }
}
async function capture(stage) {
  observations.push({ stage, data: await snapshot() });
  return page.screenshot({ path: join(directory, `${stage}.png`) });
}
async function shell(stage, target, minimumDistance = 0) {
  await page.waitForFunction(id => window.__battle.vehicles.find(item => item.id === id).weapon.ammo === 1, vehicleId);
  await aimAt(...target);
  const beforeImage = await capture(`${stage}-before`);
  const before = vehicle(await snapshot()).weapon.lastShot?.time ?? -1;
  await page.mouse.down();
  await page.waitForFunction(({ id, before }) => window.__battle.vehicles.find(item => item.id === id).weapon.lastShot?.time > before,
    { id: vehicleId, before });
  await page.mouse.up();
  let data = await snapshot(), tank = vehicle(data), shot = tank.weapon.lastShot;
  assert.equal(shot.impact, true, 'the shell hits actual scene or terrain geometry');
  assert.ok(Math.hypot(...shot.end.map((value, index) => value - shot.start[index])) >= minimumDistance);
  assert.ok(Math.abs(tank.weapon.reloadUntil - shot.time - 3.8) < 1e-8, 'crew loading starts at the shot, without R');
  assert.equal(tank.weapon.ammo, 0);
  assert.equal(data.combatEffects.lastExplosion.style, 'tank-shell');
  assert.equal(data.combatEffects.lastExplosion.rendered, true);
  assert.ok(data.combatEffects.shellClouds > 0);
  if (stage === 'distant-wall') {
    const deadline = tank.weapon.reloadUntil;
    await page.keyboard.press('Escape');
    const paused = await snapshot(); await page.waitForTimeout(300);
    assert.equal((await snapshot()).time, paused.time);
    assert.equal(vehicle(await snapshot()).weapon.reloadUntil, deadline);
    await page.locator('#resume').click();
    await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' }); await elapsed(.03);
  }
  const burstImage = await capture(`${stage}-birth`);
  if (minimumDistance >= 140) {
    const changed = await page.evaluate(async ({ before, after }) => {
      const excluded = ['#tank-reload', '#interaction-prompt', '#toast', '#hit-marker'].flatMap(selector => {
        const element = document.querySelector(selector);
        if (!element.getClientRects().length || Number(getComputedStyle(element).opacity) === 0) return [];
        const box = element.getBoundingClientRect();
        return [{ left: box.left, right: box.right, top: box.top, bottom: box.bottom }];
      });
      const read = async source => {
        const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return context.getImageData(image.width / 2 - 60, image.height / 2 - 60, 120, 120).data;
      };
      const [a, b] = await Promise.all([read(before), read(after)]);
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        const x = innerWidth / 2 - 60 + i / 4 % 120, y = innerHeight / 2 - 60 + Math.floor(i / 4 / 120);
        if (excluded.some(box => x >= box.left && x < box.right && y >= box.top && y < box.bottom)) continue;
        if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) >= 24) changed++;
      }
      return changed;
    }, { before: beforeImage.toString('base64'), after: burstImage.toString('base64') });
    observations.push({ stage: `${stage}-visible-pixels`, changed });
    assert.ok(changed >= 150, `the actual distant impact must visibly change its static roof/sky target region, not only allocate particles: ${changed}`);
  }
  const deadline = tank.weapon.reloadUntil;
  await page.keyboard.press('r');
  assert.equal(vehicle(await snapshot()).weapon.reloadUntil, deadline, 'legacy R cannot restart or accelerate automatic loading');
  await elapsed(.25); await capture(`${stage}-dust`);
  await elapsed(.7); await capture(`${stage}-smoke`);
  return deadline;
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.search = '?benchmark=full&seed=1938';
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu' ||
    !document.querySelector('#fatal').hidden, null, { timeout: 90000 });
  assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').innerText());
  await page.locator('#menu-quality').selectOption('high');
  await page.locator('#squad-choices [data-type="tank"]').click(); await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  vehicleId = (await snapshot()).controlInput.owner.vehicleId;
  await page.keyboard.press('y'); await elapsed(.15);
  await aimAt(3, 7.8, -90);
  await page.keyboard.down('Space'); await elapsed(.18); await capture('coax-below-optical-axis'); await page.keyboard.up('Space');
  let data = await snapshot(), tank = vehicle(data), mg = tank.machineGuns[0].lastShot;
  const muzzle = tankMachineGunPose(tank).start, eye = data.tankObservation.eye;
  assert.ok(Math.hypot(...mg.start.map((value, index) => value - [muzzle.x, muzzle.y, muzzle.z][index])) < 1e-8);
  const dx = mg.start[0] - eye.x, dy = mg.start[1] - eye.y, dz = mg.start[2] - eye.z;
  const projectedY = dx * Math.sin(data.look.yaw) * Math.sin(data.look.pitch) + dy * Math.cos(data.look.pitch) +
    dz * Math.cos(data.look.yaw) * Math.sin(data.look.pitch);
  assert.ok(Math.abs(projectedY + .265) < 1e-5, 'actual coax starts below the optical axis, not from an invented camera point');
  await shell('distant-wall', [3, 7.8, -90], 140);
  await shell('near-ground', [2.4, 0, 53], 15);
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(id => window.__battle.vehicles.find(item => item.id === id).weapon.ammo === 1, vehicleId);
  const previous = vehicle(await snapshot()).weapon.lastShot.time;
  await page.mouse.down();
  await page.waitForFunction(({ id, previous }) => window.__battle.vehicles.find(item => item.id === id).weapon.lastShot.time > previous,
    { id: vehicleId, previous }); await page.mouse.up();
  await page.keyboard.press('f'); await page.waitForFunction(() => window.__battle.type === 'infantry');
  await page.waitForFunction(id => window.__battle.vehicles.find(item => item.id === id).weapon.ammo === 1, vehicleId);
  assert.equal(vehicle(await snapshot()).weapon.reloadUntil, 0, 'original vehicle loads while its operator is on foot');
  assert.deepEqual(errors, []);
  console.log('PASS: physical below-sight coax, real >140m shell impact, surface blast phases, immediate crew reload, R/pause isolation and loading across F/Y.');
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await context.close(); await browser.close();
}
