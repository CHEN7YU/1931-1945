import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [], observations = [];
let stage = 'loading';
const watchdog = setTimeout(() => {
  console.error(`G2 control test exceeded 90s at stage: ${stage}`);
  void browser.close();
}, 90000);
const checkpoint = name => { stage = name; console.log(`G2: ${name}`); };
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const wait = predicate => page.waitForFunction(predicate, null, { timeout: 15000 });
const capture = async name => {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
};
async function lookAt(x, z, pitch = 0) {
  await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
  await page.evaluate(({ x, z, pitch }) => {
    const data = window.__battle;
    const yaw = Math.atan2(data.position.x - x, data.position.z - z);
    const delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - data.look.pitch) / .00132 }));
  }, { x, z, pitch });
}
async function shoot() {
  const before = (await snapshot()).ammo;
  await page.mouse.down();
  await page.waitForFunction(ammo => window.__battle.ammo < ammo || window.__battle.state === 'transferring', before);
  await page.mouse.up();
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'control'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await wait(() => window.__battle?.state === 'menu');
  checkpoint('diagnostic loaded');
  assert.equal((await snapshot()).benchmark.scenario, 'control');
  await page.locator('#squad-choices [data-type="tank"]').click(); await page.locator('#deploy').click();
  let data = await snapshot();
  const initial = data;
  assert.equal(data.entityCounts.units, 4);
  assert.equal(data.population.friendly.rosterUnits, 3);
  assert.equal(data.population.friendly.alive, 7);
  assert.equal(data.vehicles.length, 1);
  const id = data.vehicles[0].id, personId = data.control.soldierId, weaponId = data.vehicles[0].weapon.id;
  assert.equal(data.vehicles[0].seats[0].occupantId, personId);
  const ownIds = data.allies.map(actor => actor.id);
  checkpoint('fire vehicle primary');
  await shoot();
  assert.equal((await snapshot()).vehicles[0].weapon.ammo, 0);
  await page.keyboard.press('f');
  checkpoint('ground exit');
  data = await snapshot();
  assert.equal(data.type, 'infantry');
  assert.equal(data.control.soldierId, personId);
  assert.equal(data.vehicles[0].id, id);
  assert.equal(data.vehicles[0].weapon.id, weaponId);
  assert.equal(data.vehicles[0].weapon.ammo, 0);
  assert.equal(data.allies[0].vehicleId, null);
  assert.equal(data.controlInput.owner.soldierId, personId);
  assert.equal(data.controlInput.owner.vehicleId, null);
  assert.equal(data.controlInput.owner.weaponId, data.allies[0].rifle.id);
  const exited = { ...data.position };
  await lookAt(data.vehicles[0].position.x, data.vehicles[0].position.z);
  await capture('g2-ground-exit.png');
  await lookAt(exited.x + 20, exited.z, -.35);
  await shoot();
  checkpoint('ground rifle fired');
  assert.equal((await snapshot()).ammo, 4, 'ground crew use their own independent rifle');
  await page.keyboard.down('w');
  await page.mouse.down();
  await page.keyboard.press('y');
  data = await snapshot();
  assert.equal(data.type, 'tank'); assert.equal(data.current, 1);
  assert.equal(data.ammo, 0, 'Y returns to shared primary ammo rather than the dismounted rifle');
  assert.equal(data.vehicles[0].seats[1].occupantId, data.control.soldierId);
  assert.equal(data.controlInput.held.primary, false);
  assert.equal(data.controlInput.held.secondary, false);
  assert.equal(data.controlInput.held.aiming, false);
  assert.deepEqual(data.controlInput.keys, []);
  const parked = { ...data.vehicles[0].position }, beforeWait = data.time;
  await page.waitForFunction(time => window.__battle.time > time + .6, beforeWait);
  data = await snapshot();
  assert.equal(data.vehicles[0].weapon.reloadUntil, 0, 'the old held trigger cannot start an empty cannon reload on the new crew');
  assert.deepEqual(data.vehicles[0].position, parked, 'W held by the dismounted soldier does not drive a different member tank');
  await page.keyboard.up('w'); await page.mouse.up(); await page.mouse.up({ button: 'right' });
  await page.keyboard.press('y');
  await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  assert.match(await page.locator('#toast').textContent(), /驾驶员.*不能/);
  assert.equal((await snapshot()).vehicles[0].weapon.ammo, 0);
  await page.keyboard.press('y');
  checkpoint('returned to dismounted member');
  data = await snapshot();
  assert.equal(data.type, 'infantry'); assert.equal(data.control.soldierId, personId); assert.equal(data.ammo, 4);
  assert.ok(Math.hypot(data.position.x - exited.x, data.position.z - exited.z) < 1);
  await lookAt(data.vehicles[0].position.x, data.vehicles[0].position.z);
  await page.keyboard.press('f');
  checkpoint('reboarded same vehicle');
  data = await snapshot();
  assert.equal(data.type, 'tank'); assert.equal(data.control.soldierId, personId);
  assert.equal(data.vehicles[0].health, initial.vehicles[0].health);
  assert.equal(data.allies[0].rifle.ammo, 4);
  assert.equal(data.vehicles[0].weapon.ammo, 0);
  assert.deepEqual(data.allies.map(actor => actor.id), ownIds);
  await capture('g2-seat-return.png');
  observations.push({ stage: 'reboarded', control: data.control, vehicles: data.vehicles, own: data.allies });
  await page.keyboard.press('r'); await wait(() => window.__battle.ammo === 1);
  checkpoint('primary reloaded');
  await lookAt(data.position.x, data.position.z - 10, -1.24);
  await page.mouse.down();
  checkpoint('observe real blast casualty');
  const dying = await page.waitForFunction(() => {
    const data = window.__battle;
    if (data.state !== 'transferring' || data.deathTransfer.handedOff) return false;
    const observed = { state: data.state, transfer: data.deathTransfer, current: data.current, control: data.control,
      time: data.time, health: data.health, vehicles: data.vehicles, own: data.allies };
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
    return observed;
  });
  const firstDeath = await dying.jsonValue(); await dying.dispose(); await page.mouse.up();
  assert.equal(firstDeath.control.soldierId, personId, 'death is visible before control moves to another soldier');
  assert.equal(firstDeath.own[0].health, 0);
  assert.ok(firstDeath.transfer.elapsed < .6 && !firstDeath.transfer.handedOff);
  const paused = await snapshot();
  assert.equal(paused.state, 'pause');
  await page.waitForTimeout(250);
  assert.equal((await snapshot()).time, paused.time);
  assert.equal((await snapshot()).deathTransfer.elapsed, paused.deathTransfer.elapsed);
  await page.keyboard.press('y');
  assert.equal((await snapshot()).control.soldierId, personId, 'Y cannot bypass a paused death transfer');
  await page.locator('#resume').click();
  checkpoint('resume death transition');
  await page.evaluate(() => {
    const canvas = document.querySelector('#world');
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyY' }));
  });
  await capture('g2-death-feedback.png');
  await wait(() => window.__battle.state === 'playing');
  data = await snapshot();
  assert.equal(data.current, 1);
  assert.equal(data.control.soldierId, ownIds[1]);
  assert.equal(data.vehicles[0].id, id); assert.equal(data.vehicles[0].weapon.id, weaponId);
  assert.equal(data.vehicles[0].health, firstDeath.health);
  assert.equal(data.ammo, 0, 'holding a button during death feedback does not shoot or start an empty-mag reload on the new member');
  assert.equal(data.allies[1].health, 100);
  assert.equal(data.deathTransfer.active, false);
  assert.equal(await page.locator('#death-transfer').isVisible(), false);
  assert.equal(await page.locator('#damage-vignette').evaluate(element => element.style.opacity), '0', 'new crew do not inherit the dead member red damage overlay');
  observations.push({ stage: 'death-before-handoff', ...firstDeath }, { stage: 'survivor-controlled', time: data.time, control: data.control, vehicles: data.vehicles });
  for (const formation of data.population.units.filter(item => item.team === 'friendly' && !item.player)) {
    const original = initial.population.units.find(item => item.id === formation.id);
    assert.deepEqual(formation.members.map(actor => actor.id), original.members.map(actor => actor.id), 'independent friendly units survive seat changes and casualties without recreation');
    assert.ok(formation.members.some(actor => {
      const before = original.members.find(item => item.id === actor.id);
      return Math.hypot(actor.x - before.x, actor.z - before.z) > .5;
    }));
  }
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  assert.equal((await snapshot()).entityCounts.vehicles, 0);
  assert.equal((await snapshot()).entityCounts.soldiers, 0);
  assert.equal((await snapshot()).deathTransfer.active, false);
  assert.equal((await snapshot()).controlInput.owner, null);
  assert.equal((await snapshot()).controlEvents.pending, 0);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'g2-control-observations.json'), JSON.stringify(observations, null, 2));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: two autonomous units, stable vehicle/person/weapon/seat identities, F exit/reboard, Y seat/ground transfer, driver weapon restriction, independent ammo, real blast death feedback, pause/input isolation and survivor takeover.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ stage, state: data?.state, current: data?.current, control: data?.control,
    position: data?.position, vehicles: data?.vehicles, death: data?.deathTransfer, errors }));
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
