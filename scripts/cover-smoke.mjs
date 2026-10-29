import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
const wait = (fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 60000 });
async function turn(yaw, pitch = 0) {
  await page.evaluate(({ yaw, pitch }) => {
    const look = window.__battle.look;
    const scale = .00132;
    const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
    document.querySelector('#world').dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / scale, movementY: -(pitch - look.pitch) / scale }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
  }, { yaw, pitch });
}
async function walkTo(x, z) {
  for (let i = 0; i < 160; i++) {
    const data = await snapshot(), dx = x - data.position.x, dz = z - data.position.z;
    if (Math.hypot(dx, dz) < .09) break;
    await turn(Math.atan2(-dx, -dz));
    await page.keyboard.down('w');
    await page.waitForTimeout(Math.min(100, Math.max(15, Math.hypot(dx, dz) * 100)));
    await page.keyboard.up('w');
  }
  await page.waitForTimeout(500);
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < .3, `walk to real sandbags: ${JSON.stringify(data.position)}`);
}
async function capture(name) {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5187');
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('seed', '1938');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(() => window.__battle?.state === 'menu');
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.state === 'playing');
  assert.equal((await snapshot()).population.enemy.alive, 0, 'labelled real-map geometry fixture, not a combat performance claim');
  await walkTo(-12, 21.98); await turn(0);
  await page.waitForTimeout(300);
  await page.keyboard.press('v');
  assert.equal((await snapshot()).controlSimulation.weaponMount.active, false, 'V is not a weapon-support key');
  const motionStrength = (await snapshot()).locomotion.motionStrength;
  await page.keyboard.press('b');
  await wait(() => window.__battle.controlSimulation.weaponMount.active && window.__battle.controlSimulation.weaponMount.blend === 1);
  await page.mouse.down({ button: 'right' });
  await wait(() => window.__battle.fov < 49 && window.__battle.rifle.obstruction === 0);
  let data = await snapshot();
  assert.equal(data.locomotion.motionStrength, motionStrength, 'B supports the rifle rather than changing camera motion');
  observations.push({ stage: 'supported', data });
  assert.ok(data.controlSimulation.weaponMount.stability.recoil <= .301);
  assert.ok(data.controlSimulation.weaponMount.contact.y > .9);
  const ammo = data.ammo;
  await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  await wait(ammo => window.__battle.ammo < ammo, ammo);
  await capture('cover-supported-fire.png');
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('b');
  await wait(() => !window.__battle.controlSimulation.weaponMount.active);
  await page.keyboard.press('b');
  await wait(() => window.__battle.controlSimulation.weaponMount.active);
  await page.keyboard.down('s'); await page.waitForTimeout(80); await page.keyboard.up('s');
  await wait(() => !window.__battle.controlSimulation.weaponMount.active);
  await walkTo(-12, 21.98); await turn(0);
  await page.keyboard.press('Space');
  await wait(() => window.__battle.controlSimulation.traversal.kind === 'vaulting');
  data = await snapshot(); observations.push({ stage: 'vaulting', data });
  const vaultAmmo = data.ammo;
  await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
  assert.equal((await snapshot()).ammo, vaultAmmo);
  await capture('cover-vaulting.png');
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(200);
  assert.deepEqual((await snapshot()).controlSimulation, paused.controlSimulation);
  await capture('cover-vault-paused.png');
  await page.locator('#resume').click();
  await wait(() => window.__battle.controlSimulation.traversal.kind === 'grounded' && window.__battle.position.z < 20.3);
  data = await snapshot(); observations.push({ stage: 'landed', data });
  assert.equal(data.position.y, 0);
  assert.ok(data.controlEvents.history.some(event => event.type === 'movement.footstep' && event.landing));
  await page.keyboard.press('Space');
  await wait(() => window.__battle.controlSimulation.jumpHeight > .15);
  data = await snapshot();
  assert.ok(data.position.y > .15, 'jump must lift the owned body, not only the camera');
  const jumpingId = data.control.soldierId;
  await page.keyboard.press('y');
  await wait(id => window.__battle.control.soldierId !== id, jumpingId);
  assert.equal((await snapshot()).controlSimulation.jumpHeight, 0);
  await page.waitForTimeout(1000);
  data = await snapshot();
  assert.ok(Math.abs(data.allies.find(actor => actor.id === jumpingId).y) < .001, 'uncontrolled airborne member finishes their own landing');
  for (let i = 0; i < 12 && (await snapshot()).current !== 10; i++) await page.keyboard.press('y');
  await wait(() => window.__battle.current === 10 && window.__battle.rifle.ammo === 20);
  await turn(0, .35);
  await page.mouse.down();
  await wait(() => window.__battle.rifle.shots >= 3);
  await page.mouse.up(); await page.keyboard.press('r');
  await wait(() => window.__battle.rifle.action === 'reload' && window.__battle.rifle.model.reloadContact?.stage === 'insert'
    && window.__battle.rifle.elapsed > 3.8 * .59);
  observations.push({ stage: 'magazine-insertion', data: await snapshot() });
  await capture('lmg-hand-insertion.png');
  await wait(() => window.__battle.rifle.model.reloadContact?.stage === 'press');
  await capture('lmg-hand-press.png');
  await page.keyboard.press('Escape');
  data = await snapshot();
  assert.equal(data.rifle.action, 'reload');
  assert.ok(data.rifle.ammo < 20);
  observations.push({ stage: 'magazine-press', data });
  await page.waitForTimeout(200);
  assert.deepEqual((await snapshot()).rifle.model.reloadContact, data.rifle.model.reloadContact);
  await page.locator('#resume').click();
  await wait(() => window.__battle.rifle.action === 'idle' && window.__battle.rifle.ammo === 20);
  assert.deepEqual((await snapshot()).rifle.model.feedPosition, [0, 0, 0]);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'cover-smoke.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: V support and real shots, movement release, real-map sandbag vault, pause, physical jump/Y landing, hand-carried LMG insertion and press.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ errors, state: data?.state, position: data?.position, look: data?.look,
    simulation: data?.controlSimulation, rifle: data?.rifle, toast: await page.locator('#toast').textContent() }));
  throw error;
} finally {
  await browser.close();
}
