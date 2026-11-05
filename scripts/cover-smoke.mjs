import { setQualityPreset } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Vector3, Quaternion } from 'three';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
  ...(process.env.ARTIFACT_DIR ? { recordVideo: { dir: join(process.env.ARTIFACT_DIR, 'video'), size: { width: 1440, height: 900 } } } : {}) });
const recordingStarted = Date.now();
const errors = [], observations = [], phaseImages = new Map();
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
async function capture(name, phase = null) {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  if (phase) await writeFile(join(process.env.ARTIFACT_DIR, name), Buffer.from(phaseImages.get(phase).split(',')[1], 'base64'));
  else await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
}
async function pauseAtContact(kind) {
  const image = await wait(kind => {
    const data = window.__battle, rifle = data.rifle;
    const ready = kind === 'bolt' ? rifle.action === 'cycle' && rifle.elapsed >= .2 && rifle.elapsed <= .5
      : kind === 'insert' ? rifle.action === 'reload' && rifle.elapsed / 3.8 >= .60 && rifle.elapsed / 3.8 <= .68
      : rifle.action === 'reload' && rifle.model.reloadContact?.stage === 'press';
    if (!ready) return false;
    // Capture the rendered frame before pause hides first-person equipment.
    const image = document.querySelector('#world').toDataURL('image/png');
    for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { code: 'Escape', key: 'Escape', bubbles: true }));
    return image;
  }, kind);
  phaseImages.set(kind, await image.jsonValue());
  const data = await snapshot();
  observations.push({ stage: `${kind}-contact-paused`, data });
  return data;
}
async function observeVaultFireAndPause() {
  const record = await page.evaluate(() => new Promise((resolve, reject) => {
    let started = null;
    const timer = setTimeout(() => reject(new Error('No observed early vault/fire step within 60s')), 60000);
    function observe() {
      const data = window.__battle, canvas = document.querySelector('#world');
      if (!started && data.controlSimulation.traversal.kind === 'vaulting' &&
          data.controlSimulation.traversal.elapsed <= .3) {
        started = { time: data.time, ammo: data.ammo };
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      } else if (started && data.time > started.time) {
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        clearTimeout(timer);
        if (data.controlSimulation.traversal.kind !== 'vaulting') {
          reject(new Error('Vault ended before the actual blocked-fire step was observed'));
          return;
        }
        const image = canvas.toDataURL('image/png');
        for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { code: 'Escape' }));
        resolve({ data, image, beforeAmmo: started.ammo });
        return;
      }
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  }));
  phaseImages.set('vault', record.image);
  return record;
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5187');
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('seed', '1938');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wait(() => window.__battle?.state === 'menu');
  await setQualityPreset(page, 'low');
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
  assert.equal(data.rifle.action, 'idle');
  await capture('cover-supported-idle.png');
  const ammo = data.ammo;
  const boltContact = pauseAtContact('bolt');
  await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  await wait(ammo => window.__battle.ammo < ammo, ammo);
  data = await boltContact;
  assert.equal(data.rifle.model.nativeHands.source, 'nra-authorized-skinned-weapon-hands');
  assert.equal(data.rifle.model.nativeHands.right.grip.weights.bolt, 1);
  for (const side of ['left', 'right']) {
    const hand = data.rifle.model.nativeHands[side];
    assert.ok(hand.arm.reachable && hand.arm.error < .002);
    assert.equal(Object.keys(hand.grip.joints).length, 5);
  }
  assert.equal(data.rifle.model.handContact.pose, 'bolt-grip');
  assert.equal(data.rifle.model.handContact.weight, 1);
  const nativeRight = data.rifle.model.nativeHands.right;
  for (const finger of ['Index', 'Thumb']) {
    const tip = new Vector3(...nativeRight.grip.joints[finger].at(-1))
      .applyQuaternion(new Quaternion(...nativeRight.rotation)).add(new Vector3(...nativeRight.wrist));
    const distance = tip.distanceTo(new Vector3(...data.rifle.model.handContact.target));
    assert.ok(distance >= .012 && distance < .022, 'actual skinned finger tips wrap the moving bolt with pad clearance');
  }
  await capture('cover-bolt-grip-paused.png', 'bolt');
  await page.locator('#resume').click();
  await wait(() => window.__battle.rifle.action === 'idle');
  if (!(await snapshot()).controlSimulation.weaponMount.active) await page.keyboard.press('b');
  await wait(() => window.__battle.controlSimulation.weaponMount.active && window.__battle.controlSimulation.weaponMount.blend === 1);
  await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
  await wait(() => window.__battle.fov < 49);
  await capture('cover-supported-fire.png');
  const boltClipStart = (Date.now() - recordingStarted) / 1000;
  const beforeCycle = (await snapshot()).rifle.shots;
  await page.mouse.down();
  await wait(before => window.__battle.rifle.shots > before, beforeCycle);
  await page.mouse.up();
  await wait(() => window.__battle.rifle.action === 'idle');
  await page.waitForTimeout(500);
  observations.push({ stage: 'continuous-bolt-video', startSeconds: boltClipStart,
    endSeconds: (Date.now() - recordingStarted) / 1000, data: await snapshot() });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('b');
  await wait(() => !window.__battle.controlSimulation.weaponMount.active);
  await page.keyboard.press('b');
  await wait(() => window.__battle.controlSimulation.weaponMount.active);
  await page.keyboard.press('3');
  await wait(() => window.__battle.dadao.phase === 'ready');
  assert.equal((await snapshot()).controlSimulation.weaponMount.active, false, 'drawing the dadao releases rifle support');
  await page.keyboard.press('b');
  assert.equal((await snapshot()).controlSimulation.weaponMount.active, false, 'a sword cannot mount as a rifle at the same support point');
  await page.keyboard.press('1');
  await page.waitForTimeout(500);
  await page.keyboard.press('b');
  await wait(() => window.__battle.controlSimulation.weaponMount.active);
  await page.keyboard.down('s');
  await wait(() => !window.__battle.controlSimulation.weaponMount.active);
  await page.keyboard.up('s');
  await walkTo(-12, 21.98); await turn(0);
  // Observe and act inside actual simulated vault frames, not after a potentially slow CDP round trip.
  const vaultObservation = observeVaultFireAndPause();
  await page.keyboard.press('Space');
  const vault = await vaultObservation;
  data = vault.data; observations.push({ stage: 'vaulting', data });
  assert.equal(data.ammo, vault.beforeAmmo);
  assert.equal((await snapshot()).ammo, vault.beforeAmmo);
  await capture('cover-vaulting.png', 'vault');
  const paused = await snapshot();
  assert.equal(paused.state, 'pause');
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
  data = await pauseAtContact('insert');
  assert.equal(data.rifle.model.nativeHands.left.grip.weights.magazine, 1);
  assert.equal(data.rifle.model.handContact.pose, 'magazine-grip');
  observations.push({ stage: 'magazine-insertion', data: await snapshot() });
  await capture('lmg-hand-insertion.png', 'insert');
  await page.locator('#resume').click();
  data = await pauseAtContact('press');
  assert.equal(data.rifle.action, 'reload');
  assert.ok(data.rifle.ammo < 20);
  assert.equal(data.rifle.model.reloadContact.stage, 'press');
  assert.equal(data.rifle.model.nativeHands.left.grip.weights.press, 1);
  observations.push({ stage: 'magazine-press', data });
  assert.equal(data.rifle.model.handContact.pose, 'magazine-press');
  await capture('lmg-hand-press-paused.png', 'press');
  await page.waitForTimeout(200);
  assert.deepEqual((await snapshot()).rifle.model.reloadContact, data.rifle.model.reloadContact);
  await page.locator('#resume').click();
  await wait(() => window.__battle.rifle.action === 'idle' && window.__battle.rifle.ammo === 20);
  assert.deepEqual((await snapshot()).rifle.model.feedPosition, [0, 0, 0]);
  const continuousStart = (Date.now() - recordingStarted) / 1000;
  const shots = (await snapshot()).rifle.shots;
  await page.mouse.down();
  await wait(shots => window.__battle.rifle.shots >= shots + 3, shots);
  await page.mouse.up();
  await wait(() => window.__battle.rifle.action === 'idle');
  await page.keyboard.press('r');
  await wait(() => window.__battle.rifle.action === 'reload');
  await wait(() => window.__battle.rifle.action === 'idle' && window.__battle.rifle.ammo === 20);
  await page.waitForTimeout(500);
  observations.push({ stage: 'continuous-reload-video', startSeconds: continuousStart,
    endSeconds: (Date.now() - recordingStarted) / 1000, data: await snapshot() });
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'cover-smoke.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: B support, V not bound, dadao releases and cannot mount, real shots, movement release, real-map sandbag vault, pause, physical jump/Y landing, hand-carried LMG insertion and press.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ errors, state: data?.state, position: data?.position, look: data?.look,
    simulation: data?.controlSimulation, rifle: data?.rifle, toast: await page.locator('#toast').textContent() }));
  throw error;
} finally {
  await browser.close();
}
