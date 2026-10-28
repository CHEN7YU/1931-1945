import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [], observations = [];
let stage = 'loading';
const watchdog = setTimeout(() => { console.error(`Grenade check timed out at ${stage}`); void browser.close(); }, 180000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
async function waitSeconds(seconds) {
  const before = (await snapshot()).time;
  await page.waitForFunction(({ before, seconds }) => window.__battle.time >= before + seconds, { before, seconds });
}
async function aim(pitch, yaw = 0) {
  await page.mouse.move(720, 450);
  await page.mouse.down({ button: 'right' });
  await page.evaluate(({ pitch, yaw }) => {
    const data = window.__battle, delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
    const sensitivity = data.controlInput.held.aiming ? .00132 : .0022;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / sensitivity, movementY: -(pitch - data.look.pitch) / sensitivity }));
  }, { pitch, yaw });
  await page.mouse.up({ button: 'right' });
  const actual = (await snapshot()).look;
  assert.ok(Math.abs(actual.pitch - pitch) < .003, `actual look ${actual.pitch}, requested ${pitch}`);
}
async function reset() {
  let data = await snapshot();
  if (['playing', 'transferring'].includes(data.state)) await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  data = await snapshot();
  assert.equal(data.grenades.active.length, 0); assert.equal(data.grenades.history.length, 0);
  assert.equal(data.grenades.renderer.views, 0); assert.equal(data.grenades.renderer.handVisible, false);
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
}
async function prime(slot = '5') {
  await page.keyboard.press(slot);
  await page.waitForFunction(() => window.__battle.grenades.renderer.handVisible);
  await page.waitForTimeout(150);
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === 'cooking');
  return snapshot();
}
async function tapGrenade(slot = '5') {
  await page.keyboard.press(slot);
  await page.waitForFunction(() => window.__battle.grenades.renderer.handVisible);
  await page.waitForTimeout(150);
  await page.mouse.move(720, 450); await page.mouse.click(720, 450);
}
async function walkTo(x, z) {
  await page.keyboard.down('c');
  for (let i = 0; i < 180; i++) {
    const data = await snapshot(), dx = x - data.position.x, dz = z - data.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < .17) break;
    assert.equal(data.state, 'playing');
    if (distance < .75) await page.keyboard.up('w');
    await aim(0, Math.atan2(-dx, -dz));
    await page.keyboard.down('w');
    await page.waitForTimeout(Math.min(100, Math.max(10, distance / 1.5 * 180)));
    if (distance < .75) {
      await page.keyboard.up('w');
      await page.waitForTimeout(130);
    }
  }
  await page.keyboard.up('w'); await page.keyboard.up('c');
  await page.waitForTimeout(150);
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < .4, `ordinary movement reaches ${x}, ${z}`);
}
try {
  if (process.env.ARTIFACT_DIR) await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5197');
  url.searchParams.set('benchmark', 'interior'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#deploy').click();
  let data = await snapshot();
  assert.ok(data.allies.every(actor => actor.grenades.ammo === 1 && actor.grenades.packs === 1));
  assert.match(await page.locator('#grenade-status').textContent(), /手雷 1\/1/);
  stage = 'number slot selects an unprimed grenade without spending inventory';
  await page.keyboard.press('5'); await waitSeconds(.8);
  data = await snapshot();
  assert.equal(data.grenades.equipped, true);
  assert.equal(data.grenades.active.length, 0);
  assert.equal(data.grenades.inventory.ammo, 1);
  assert.equal(data.grenades.inventory.packs, 1);
  assert.equal(data.grenades.renderer.handVisible, true);
  assert.equal(data.grenades.renderer.handDetail.fingersPerHand, 5);
  if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'selected-detailed-hand.png') });
  await page.keyboard.press('1'); assert.equal((await snapshot()).weaponVisible, true);

  stage = 'selecting a throwable during the bolt cycle stows and pauses the rifle without trapping the selected slot';
  await aim(.2); await page.mouse.down();
  await page.waitForFunction(() => window.__battle.rifle.shots > 0);
  await page.mouse.up();
  const firedAmmo = (await snapshot()).ammo;
  await prime();
  assert.equal((await snapshot()).rifle.ammo, firedAmmo);
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === null);
  await page.keyboard.press('1');
  assert.equal((await snapshot()).rifle.ammo, firedAmmo);
  await reset();
  data = await snapshot();

  stage = 'pre-pin cancellation and independent inventory';
  const firstId = data.control.soldierId;
  await page.keyboard.press('5'); await page.mouse.move(720, 450); await page.mouse.down();
  await page.keyboard.press('y');
  await page.mouse.up();
  data = await snapshot();
  assert.notEqual(data.control.soldierId, firstId);
  assert.equal(data.allies.find(actor => actor.id === firstId).grenades.ammo, 1);
  assert.equal(data.grenades.active.length, 0);

  stage = 'cooking, release, real rendering and frozen in-flight pause';
  await aim(-.1);
  const primed = await prime(), id = primed.grenades.active[0].id;
  assert.equal(primed.grenades.inventory.ammo, 0);
  assert.equal(primed.grenades.inventory.packs, 1);
  assert.equal(primed.weaponVisible, false);
  assert.equal(primed.grenades.renderer.handVisible, true);
  const rifleAmmo = primed.ammo;
  await page.keyboard.press('r');
  assert.equal((await snapshot()).ammo, rifleAmmo);
  await waitSeconds(.55);
  const cooked = await snapshot();
  assert.equal(cooked.grenades.active[0].phase, 'cooking');
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.grenades.active.some(grenade => grenade.phase === 'flight'));
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(300);
  const still = await snapshot();
  assert.equal(still.time, paused.time); assert.deepEqual(still.grenades.active, paused.grenades.active);
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__battle.grenades.history.some(event => event.type === 'explosion'));
  data = await snapshot();
  const impact = data.grenades.history.find(event => event.type === 'explosion');
  assert.ok(data.combatEffects.blastClouds > 0, 'a real grenade explosion produces layered blast effects');
  if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'actual-grenade-explosion.png') });
  assert.equal(impact.id, id); assert.equal(impact.time, primed.grenades.active[0].detonateAt);
  assert.equal(impact.source.weaponId, `${primed.control.soldierId}:grenades`);
  assert.ok(impact.collisions > 0, 'real world geometry / terrain causes collision before timed detonation');
  assert.equal(data.grenades.inventory.ammo, 0);
  assert.equal(data.grenades.active.length, 0); assert.equal(data.grenades.renderer.views, 0);
  assert.equal(data.weaponVisible, false, 'the selected grenade slot does not silently switch back to the rifle');
  await page.keyboard.press('1'); assert.equal((await snapshot()).weaponVisible, true);
  observations.push({ stage, cooked: cooked.grenades, impact });

  stage = 'quick throw and real nearby throwback keep the same fuse and inventory';
  await reset(); await aim(-1.25);
  await tapGrenade();
  await page.waitForFunction(() => window.__battle.grenades.active.some(grenade => grenade.phase === 'flight'));
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === null);
  await page.keyboard.down('w');
  await page.waitForFunction(() => document.getElementById('grenade-warning').textContent.includes('回掷'));
  await page.keyboard.up('w');
  data = await snapshot();
  assert.equal(data.grenades.inventory.ammo, 0);
  assert.ok(await page.locator('#grenade-warning').isVisible());
  assert.match(await page.locator('#grenade-warning').textContent(), /回掷/);
  const original = data.grenades.active[0];
  await aim(.5); await tapGrenade();
  await page.waitForFunction(() => window.__battle.grenades.history.filter(event => event.type === 'throw').length === 2);
  data = await snapshot();
  assert.equal(data.grenades.active.length, 1); assert.equal(data.grenades.active[0].id, original.id);
  assert.equal(data.grenades.active[0].detonateAt, original.detonateAt);
  assert.equal(data.grenades.inventory.ammo, 0);
  await page.waitForFunction(() => window.__battle.grenades.history.some(event => event.type === 'explosion'));
  observations.push({ stage, original, result: (await snapshot()).grenades });

  stage = 'changing soldier drops a live grenade without harming other friendly soldiers';
  await reset();
  const held = await prime(), old = held.control.soldierId, deadline = held.grenades.active[0].detonateAt;
  await page.keyboard.press('y'); await page.mouse.up();
  data = await snapshot();
  assert.notEqual(data.control.soldierId, old);
  assert.equal(data.grenades.active[0].holderId, null);
  assert.equal(data.grenades.active[0].source.soldierId, old);
  assert.equal(data.allies.find(actor => actor.id === old).grenades.ammo, 0);
  assert.equal(data.grenades.inventory.ammo, 1);
  await page.waitForFunction(() => window.__battle.grenades.history.some(event => event.type === 'explosion'));
  data = await snapshot();
  assert.equal(data.grenades.history.find(event => event.type === 'explosion').time, deadline);
  assert.ok(data.allies.filter(actor => actor.id !== old).every(actor => actor.health === 100));
  observations.push({ stage, result: data.grenades });

  stage = 'self damage causes ordinary death transfer; no duplicated blast or inventory refund';
  await reset(); await aim(-1.25); await tapGrenade();
  const thrower = (await snapshot()).control.soldierId;
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === null);
  await page.keyboard.down('w'); await waitSeconds(1); await page.keyboard.up('w');
  await page.waitForFunction(() => window.__battle.grenades.history.some(event => event.type === 'explosion'));
  data = await snapshot();
  const casualty = data.allies.find(actor => actor.id === thrower);
  assert.equal(casualty.health, 0);
  assert.equal(casualty.grenades.ammo, 0);
  assert.equal(casualty.deathSource.weaponId, `${thrower}:grenades`);
  assert.ok(data.allies.filter(actor => actor.id !== thrower).every(actor => actor.health === 100));
  assert.equal(data.grenades.history.filter(event => event.type === 'explosion').length, 1);
  observations.push({ stage, casualty, state: data.state });

  stage = 'new match clears even an armed held grenade';
  await reset(); await prime();
  await page.keyboard.press('Escape');
  const heldPause = await snapshot();
  await page.mouse.up(); await page.waitForTimeout(200);
  assert.deepEqual((await snapshot()).grenades.active, heldPause.grenades.active);
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__battle.grenades.active.some(grenade => grenade.phase === 'flight'));
  await reset();
  assert.equal((await snapshot()).grenades.inventory.ammo, 1);
  await waitSeconds(5);
  assert.equal((await snapshot()).grenades.history.length, 0);

  stage = 'standing, crouched and prone release from owned posture heights';
  const heights = [];
  for (const [stance, key] of [['standing', null], ['crouched', 'ControlLeft'], ['prone', 'z']]) {
    await reset();
    if (key) await page.keyboard.press(key);
    await waitSeconds(.6);
    await aim(.2); await prime();
    await page.mouse.up();
    await page.waitForFunction(() => window.__battle.grenades.active.some(grenade => grenade.phase === 'flight'));
    const thrown = await snapshot();
    assert.equal(thrown.stance, stance);
    assert.equal(thrown.grenades.inventory.ammo, 0);
    assert.equal(thrown.grenades.active[0].throws, 1);
    heights.push(thrown.grenades.active[0].position.y);
    observations.push({ stage, stance, position: thrown.grenades.active[0].position });
  }
  assert.ok(heights[0] > heights[1] + .3 && heights[1] > heights[2] + .3);

  stage = 'closed authored door blocks a real thrown grenade and never becomes impact detonation';
  await reset();
  await aim(-1.25); await page.keyboard.press('x');
  await walkTo(0, 64); await walkTo(-2.4, 64);
  const doorId = 'west-0-east-door';
  assert.equal((await snapshot()).doors.find(door => door.id === doorId).state, 'closed');
  await aim(0, Math.PI / 2);
  await tapGrenade();
  await page.waitForFunction(() => window.__battle.grenades.active.some(grenade => grenade.collisions > 0));
  data = await snapshot();
  assert.equal(data.grenades.history.some(event => event.type === 'explosion'), false);
  assert.ok(data.grenades.active[0].position.x > -4.5, 'the grenade remains outside the closed shop door');
  assert.equal(data.doors.find(door => door.id === doorId).state, 'closed');
  observations.push({ stage, grenade: data.grenades.active[0], door: data.doors.find(door => door.id === doorId) });
  await page.keyboard.press('Escape');
  if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'grenade-door-collision.png') });
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__battle.grenades.history.some(event => event.type === 'explosion'));
  data = await snapshot();
  assert.ok(data.grenades.history.find(event => event.type === 'explosion').position.x > -4.5);
  assert.equal(data.grenades.history.filter(event => event.type === 'explosion').length, 1);

  stage = 'grenade slot replaces engineer tool and explicit number selection restores it without a stale blueprint';
  await reset(); await page.keyboard.press('2');
  assert.equal((await snapshot()).construction.tool, true);
  await aim(.5); await prime();
  assert.equal((await snapshot()).weaponVisible, false);
  assert.equal((await snapshot()).construction.blueprint, false);
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === null);
  data = await snapshot();
  assert.equal(data.construction.tool, false);
  assert.equal(data.weaponVisible, false);
  await page.keyboard.press('2');
  assert.equal((await snapshot()).construction.tool, true);
  assert.equal((await snapshot()).weaponVisible, true);
  assert.equal(data.grenades.inventory.ammo, 0);
  observations.push({ stage, construction: data.construction, inventory: data.grenades.inventory });

  stage = 'one timed explosive pack is selected with 6, is distinct from the grenade, and preserves its own identity/count';
  await reset(); await page.keyboard.press('6'); await waitSeconds(.8);
  data = await snapshot();
  assert.equal(data.grenades.selected, 'explosive-pack');
  assert.equal(data.grenades.renderer.heldKind, 'explosive-pack');
  assert.equal(data.grenades.active.length, 0);
  assert.equal(data.grenades.inventory.ammo, 1); assert.equal(data.grenades.inventory.packs, 1);
  if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'selected-explosive-pack.png') });
  await aim(.2); const packPrimed = await prime('6');
  assert.equal(packPrimed.grenades.inventory.ammo, 1); assert.equal(packPrimed.grenades.inventory.packs, 0);
  assert.equal(packPrimed.grenades.active[0].kind, 'explosive-pack');
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.grenades.active.some(item => item.phase === 'flight'));
  await page.keyboard.press('Escape');
  const packPause = await snapshot(); await page.waitForTimeout(150);
  assert.deepEqual((await snapshot()).grenades.active, packPause.grenades.active);
  await page.locator('#resume').click();
  await page.waitForFunction(() => window.__battle.grenades.history.some(item => item.type === 'explosion' && item.kind === 'explosive-pack'));
  data = await snapshot();
  assert.equal(data.grenades.history.find(item => item.type === 'explosion').source.weaponId, `${packPrimed.control.soldierId}:explosive-pack`);
  assert.equal(data.grenades.inventory.packs, 0); assert.equal(data.grenades.inventory.ammo, 1);
  await page.keyboard.press('5');
  await page.waitForFunction(() => window.__battle.grenades.renderer.heldKind === 'grenade');
  observations.push({ stage, inventory: data.grenades.inventory, history: data.grenades.history });

  stage = 'seated crew cannot throw; dismounted crew retain personal grenades across a seat takeover';
  url.searchParams.set('benchmark', 'control');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  const seated = await snapshot();
  assert.ok(seated.controlInput.owner.vehicleId);
  await page.keyboard.press('5'); await page.mouse.click(720, 450);
  data = await snapshot();
  assert.equal(data.grenades.active.length, 0);
  assert.equal(data.grenades.inventory.ammo, 1);
  await page.keyboard.press('f');
  assert.equal((await snapshot()).controlInput.owner.vehicleId, null);
  await prime();
  await page.keyboard.press('y'); await page.mouse.up();
  data = await snapshot();
  assert.notEqual(data.control.soldierId, seated.control.soldierId);
  assert.equal(data.controlInput.owner.vehicleId, seated.controlInput.owner.vehicleId);
  assert.equal(data.grenades.active[0].holderId, null);
  assert.equal(data.grenades.active[0].source.soldierId, seated.control.soldierId);
  assert.equal(data.allies.find(actor => actor.id === seated.control.soldierId).grenades.ammo, 0);
  assert.equal(data.grenades.inventory.ammo, 1);
  for (const field of ['id', 'ownerId', 'ammo', 'reloadUntil']) {
    assert.equal(data.vehicles[0].weapon[field], seated.vehicles[0].weapon[field]);
  }
  await page.waitForFunction(id => window.__battle.allies.find(actor => actor.id === id).mode === 'evade-grenade',
    seated.control.soldierId);
  observations.push({ stage, control: data.control, grenades: data.grenades });
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  assert.equal((await snapshot()).grenades.active.length, 0);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'grenade-observations.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: personal grenades, cancel, cook/release, pause, throwback, unchanged fuse, self-only friendly damage, death transfer, cleanup, three posture heights, closed-door bounce, engineer tool restoration and dismounted crew ownership.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ stage, state: data?.state, grenades: data?.grenades, allies: data?.allies, errors }));
  throw error;
} finally {
  clearTimeout(watchdog); await browser.close();
}
