import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
let stage = 'loading';
const watchdog = setTimeout(() => {
  console.error(`Continuous stability exceeded 180s at ${stage}`);
  void browser.close();
}, 180000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const wait = (predicate, arg = null) => page.waitForFunction(predicate, arg, { timeout: 20000 });
async function checkpoint(name) {
  stage = name;
  const data = await snapshot();
  observations.push({ stage, state: data.state, time: data.time, control: data.control,
    input: data.controlInput, ammo: data.ammo, stance: data.stance, simulation: data.controlSimulation,
    hands: data.rifle?.model?.nativeHands, grenades: data.grenades.inventory });
  assert.equal(await page.locator('#fatal').isVisible(), false, `${stage}: no fatal overlay`);
  assert.deepEqual(errors, [], `${stage}: no browser/runtime errors`);
  console.log(`Stability: ${name}`);
  return data;
}
async function turn(yaw, pitch = 0) {
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'right' });
  await page.evaluate(({ yaw, pitch }) => {
    const look = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: -delta / .00132, movementY: -(pitch - look.pitch) / .00132,
    }));
  }, { yaw, pitch });
}
async function advances() {
  const before = (await snapshot()).time;
  await wait(time => window.__battle.time > time + .35, before);
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.searchParams.set('benchmark', 'interior'); url.searchParams.set('seed', '1938');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await wait(() => window.__battle?.state === 'menu');
  assert.equal((await snapshot()).benchmark.scenario, 'interior', 'requires a development diagnostic, not reduced formal population');
  await page.locator('#menu-quality').selectOption('low');
  let initialCounts;
  for (let round = 1; round <= 2; round++) {
    await page.locator('#deploy').click();
    await wait(() => window.__battle.state === 'playing');
    let data = await checkpoint(`round-${round}-deployed`);
    const originalId = data.control.soldierId, fullAmmo = data.ammo;
    initialCounts ??= data.entityCounts;
    assert.deepEqual(data.entityCounts, initialCounts, 'restart does not accumulate actors/vehicles');
    assert.equal(data.rifle.shots, 0);
    assert.equal(data.grenades.inventory.phase, null);
    assert.deepEqual(data.controlInput.keys, []);
    assert.ok(data.time < 2, 'restart resets match simulation time');
    await turn(Math.PI);
    await page.keyboard.down('w');
    await wait(() => window.__battle.rifle.obstruction > .5);
    await page.keyboard.up('w');
    await advances();
    await checkpoint(`round-${round}-wall-still-playing`);
    for (const [key, stance] of [['ControlLeft', 'crouched'], ['z', 'prone'], ['z', 'standing']]) {
      await page.keyboard.press(key);
      await wait(stance => window.__battle.stance === stance, stance);
      await advances();
      await checkpoint(`round-${round}-wall-${stance}`);
    }
    await turn(0);
    await wait(() => window.__battle.rifle.obstruction === 0 &&
      window.__battle.rifle.model?.nativeHands?.visible);
    data = await checkpoint(`round-${round}-arms-recovered`);
    assert.equal(data.ammo, fullAmmo);
    assert.equal(data.rifle.model.nativeHands.reachLimited, false);
    await page.mouse.down();
    await wait(ammo => window.__battle.ammo === ammo - 1, fullAmmo);
    await page.mouse.up();
    await wait(() => window.__battle.rifle.action === 'idle');
    await page.keyboard.press('ControlLeft');
    await page.keyboard.press('r');
    // Pause on the observed reload, not after an arbitrary wall-clock delay.
    await wait(() => {
      if (window.__battle.rifle.action !== 'reload') return false;
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
      return true;
    });
    const paused = await checkpoint(`round-${round}-reload-paused`);
    assert.equal(paused.state, 'pause');
    assert.equal(paused.rifle.action, 'reload');
    assert.equal(paused.ammo, fullAmmo - 1, 'reload cannot refill the magazine before completion');
    await page.waitForTimeout(300);
    data = await snapshot();
    assert.equal(data.time, paused.time);
    assert.deepEqual(data.rifle, paused.rifle, 'pause freezes the actual owned reload and hand pose');
    await page.locator('#resume').click();
    await wait(() => window.__battle.rifle.action === 'idle');
    data = await checkpoint(`round-${round}-reload-finished`);
    assert.equal(data.ammo, fullAmmo, 'reload replenishes only on completion');
    await page.keyboard.press('ControlLeft');
    await turn(0);
    await page.mouse.down();
    await wait(ammo => window.__battle.ammo === ammo - 1, fullAmmo);
    await page.mouse.up();
    await wait(() => window.__battle.rifle.action === 'idle');
    const spentAmmo = (await snapshot()).ammo;
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('3');
    await wait(() => window.__battle.dadao.phase === 'ready');
    await page.mouse.down();
    await wait(() => window.__battle.dadao.phase !== 'ready');
    await page.mouse.up();
    await wait(() => window.__battle.dadao.phase === 'ready');
    await page.keyboard.press('5');
    await wait(() => window.__battle.grenades.equipped);
    const inventory = { ...(await snapshot()).grenades.inventory };
    await page.keyboard.press('1');
    await wait(() => window.__battle.rifle.model?.nativeHands?.visible);
    data = await checkpoint(`round-${round}-equipment-return`);
    assert.equal(data.ammo, spentAmmo);
    assert.deepEqual(data.grenades.inventory, inventory, 'selecting/stowing a grenade does not consume or refill it');
    const ownAmmo = new Map(data.allies.map(actor => [actor.id, actor.rifle.ammo]));
    await page.mouse.down({ button: 'right' });
    await page.keyboard.down('w');
    await page.keyboard.press('y');
    await wait(id => window.__battle.control.soldierId !== id, originalId);
    data = await checkpoint(`round-${round}-held-input-Y`);
    assert.deepEqual(data.controlInput.keys, []);
    assert.equal(data.controlInput.held.primary, false);
    assert.equal(data.controlInput.held.secondary, false);
    assert.equal(data.controlInput.held.aiming, false);
    assert.equal(data.ammo, ownAmmo.get(data.control.soldierId), 'new member reads their own magazine');
    const position = { ...data.position };
    await advances();
    data = await snapshot();
    assert.ok(Math.hypot(data.position.x - position.x, data.position.z - position.z) < .02,
      'held W does not move the newly possessed member');
    await page.keyboard.up('w'); await page.mouse.up({ button: 'right' });
    for (let i = 1; i < data.allies.length; i++) await page.keyboard.press('y');
    data = await checkpoint(`round-${round}-original-owner-return`);
    assert.equal(data.control.soldierId, originalId);
    assert.equal(data.ammo, spentAmmo, 'Y and equipment changes cannot refill the original magazine');
    assert.equal(data.controlSimulation.dadaoEquipped, false);
    assert.equal(data.controlSimulation.grenadeEquipped, false);
    await advances();
    await page.keyboard.press('Escape');
    await page.locator('#back-menu').click();
    data = await checkpoint(`round-${round}-returned-to-menu`);
    assert.equal(data.state, 'menu');
    assert.equal(data.entityCounts.soldiers, 0);
    assert.equal(data.entityCounts.vehicles, 0);
    assert.equal(data.controlInput.owner, null);
    assert.deepEqual(data.controlInput.keys, []);
    assert.equal(data.deathTransfer.active, false);
    assert.equal(data.grenades.active.length, 0);
  }
  console.log('PASS: two uninterrupted match chains cover wall/posture/recovery/fire/reload/pause/equipment/Y/input ownership/menu/restart.');
} finally {
  clearTimeout(watchdog);
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'continuous-stability.json'),
        JSON.stringify({ stage, observations, errors }, null, 2));
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'continuous-stability-final.png') });
    }
  } finally { await browser.close(); }
}
