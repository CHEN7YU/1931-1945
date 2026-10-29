import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocomotion, advanceLocomotion } from '../src/locomotion.js';

const artifacts = process.env.ARTIFACT_DIR;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(artifacts ? { recordVideo: { dir: artifacts, size: { width: 1440, height: 900 } } } : {}),
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let controlsContext;
async function sample(ms) {
  return page.evaluate(duration => new Promise(resolve => {
    const samples = [], start = performance.now();
    function frame() {
      const data = window.__battle;
      samples.push({ time: data.time, current: data.current, ...data.locomotion });
      if (performance.now() - start >= duration) resolve(samples);
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), ms);
}
function lane(distance, mode, fps) {
  const motion = createLocomotion(), position = { x: 0, z: 0 };
  const input = { type: 'infantry', forward: 1, sideways: 0, yaw: 0, stance: 'standing', grounded: true, walking: mode === 'walk', sprint: mode === 'sprint' };
  let elapsed = 0;
  while (motion.distance < distance && elapsed < 60) {
    advanceLocomotion(motion, position, input, [], 1 / fps);
    elapsed += 1 / fps;
  }
  return { mode, distance, fps, seconds: Number(elapsed.toFixed(3)), stamina: Number(motion.stamina.toFixed(3)) };
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#deploy').click();
  await page.waitForTimeout(1000);
  await page.keyboard.down('w');
  const jogging = await sample(1500);
  await page.keyboard.down('Shift');
  const sprinting = await sample(1800);
  await page.keyboard.up('Shift'); await page.keyboard.up('w');
  const stopping = await sample(1000);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(1000);
  await page.mouse.up({ button: 'right' });
  const moved = await page.evaluate(() => window.__battle);
  const footsteps = moved.controlEvents.history.filter(event => event.type === 'movement.footstep');
  assert.ok(footsteps.length > 0);
  assert.ok(footsteps.some(event => event.speed > 3 && event.stance === 'standing'), 'actual jogging/sprinting emits captured movement feedback');
  assert.ok(footsteps.every(event => moved.allies.some(actor => actor.id === event.soldierId && actor.unitId === event.unitId)));
  assert.ok(footsteps.every(event => ['stone', 'earth', 'wood'].includes(event.surface)));
  assert.ok(footsteps.some(event => event.surface === moved.locomotion.surface));
  if (artifacts) await page.screenshot({ path: join(artifacts, 'movement-after.png') });
  const video = page.video();
  if (video) {
    // End this clip here so it matches the saved pre-change action sequence.
    await page.close();
    await rename(await video.path(), join(artifacts, 'movement-after.webm'));
  }
  assert.ok(jogging.some(frame => frame.speed > 3 && frame.speed <= 3.151));
  assert.ok(sprinting.some(frame => frame.speed > 4.6 && frame.speed <= 4.801));
  assert.ok(Math.max(...sprinting.map(frame => frame.cameraHeight)) - Math.min(...sprinting.map(frame => frame.cameraHeight)) > .05, 'sprint has visible but bounded vertical weight shift');
  assert.ok(sprinting.at(-1).stamina < .85);
  assert.equal(stopping.at(-1).speed, 0);
  assert.ok(Math.abs(stopping.at(-1).cameraHeight - stopping.at(-1).eyeHeight) < .001,
    'stopping settles to the current soldier eye height, not a fixed generic body height');

  // Remaining checks use normal keys/mouse in a separate page, without mutation hooks.
  controlsContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const controls = await controlsContext.newPage();
  controls.on('pageerror', error => errors.push(error.message));
  await controls.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await controls.waitForFunction(() => window.__battle?.state === 'menu');
  await controls.locator('#deploy').click();
  await controls.keyboard.down('w'); await controls.keyboard.down('Shift');
  await controls.waitForFunction(() => window.__battle.locomotion.speed > 4.6);
  const attempt = await controls.evaluate(() => new Promise(resolve => {
    const before = window.__battle, canvas = document.querySelector('#world');
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    requestAnimationFrame(() => {
      const after = window.__battle;
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      resolve({ ammo: before.ammo, afterAmmo: after.ammo, recovery: after.locomotion.aimRecovery, fov: after.fov,
        beforeTime: before.time, afterTime: after.time });
    });
  }));
  assert.ok(attempt.recovery > 0, 'inspect an actual recovery frame, not a delayed browser round-trip');
  assert.ok(attempt.fov > 55, 'sprint cannot jump straight to fully aligned sights');
  assert.equal(attempt.afterAmmo, attempt.ammo, 'firing is blocked while recovering from sprint');
  const ammo = attempt.ammo;
  let data;
  await controls.waitForFunction(() => window.__battle.locomotion.aimRecovery === 0 && window.__battle.fov < 50);
  data = await controls.evaluate(() => window.__battle);
  assert.ok(data.locomotion.speed <= 1.51);
  await controls.mouse.down(); await controls.waitForTimeout(90); await controls.mouse.up();
  assert.equal((await controls.evaluate(() => window.__battle)).ammo, ammo - 1, 'weapon fires normally after recovery');
  await controls.mouse.up({ button: 'right' });
  await controls.keyboard.up('w'); await controls.keyboard.up('Shift');
  await controls.keyboard.press('Escape');
  const paused = await controls.evaluate(() => window.__battle);
  await controls.waitForTimeout(250);
  assert.equal((await controls.evaluate(() => window.__battle)).time, paused.time);
  assert.deepEqual((await controls.evaluate(() => window.__battle)).controlEvents, paused.controlEvents, 'pause cannot replay movement or door requests');
  await controls.locator('#motion-strength').selectOption('0');
  await controls.locator('#resume').click();
  await controls.keyboard.down('w');
  await controls.waitForTimeout(700);
  data = await controls.evaluate(() => window.__battle);
  assert.equal(data.locomotion.motionStrength, 0);
  assert.equal(data.locomotion.cameraHeight, data.locomotion.eyeHeight);
  assert.equal(Math.abs(data.locomotion.cameraRoll), 0);
  assert.ok(data.locomotion.speed > 3);
  await controls.keyboard.up('w');
  await controls.keyboard.press('Escape');
  await controls.locator('#motion-strength').selectOption('1');
  assert.equal((await controls.evaluate(() => window.__battle)).locomotion.motionStrength, 1);
  await controls.locator('#back-menu').click();
  await controls.locator('#deploy').click();
  await controls.keyboard.down('s');
  await controls.waitForFunction(() => {
    const m = window.__battle.locomotion;
    return m.distance > 5 && m.speed === 0;
  }, null, { timeout: 7000 });
  const wall = await controls.evaluate(() => window.__battle);
  await controls.waitForTimeout(800);
  data = await controls.evaluate(() => window.__battle);
  assert.equal(data.locomotion.steps, wall.locomotion.steps, 'holding into the rear building makes no new steps');
  assert.equal(data.locomotion.footsteps, wall.locomotion.footsteps);
  assert.ok(Math.abs(data.locomotion.cameraY) < .00001);
  await controls.keyboard.up('s');
  await controls.keyboard.press('Escape');
  await controls.locator('#back-menu').click();
  await controls.locator('#deploy').click();
  await controls.keyboard.down('w'); await controls.keyboard.down('Shift');
  await controls.waitForFunction(() => window.__battle.locomotion.exhausted, null, { timeout: 13000 });
  await controls.keyboard.up('w'); await controls.keyboard.up('Shift');
  data = await controls.evaluate(() => window.__battle);
  const spent = data.locomotion.stamina;
  assert.ok(spent < .05);
  assert.equal(data.current, 0);
  const beforeSwitch = data;
  const incomingIndex = data.allies.findIndex((actor, index) => index > 0 && actor.health > 0);
  assert.ok(incomingIndex > 0);
  await controls.keyboard.press('y');
  await controls.waitForFunction(index => window.__battle.current === index, incomingIndex);
  data = await controls.evaluate(() => window.__battle);
  const switchElapsed = data.time - beforeSwitch.time;
  const staminaChange = data.locomotion.stamina - beforeSwitch.allies[incomingIndex].stamina;
  assert.ok(staminaChange >= -.14 * switchElapsed - .00001 && staminaChange <= .1 * switchElapsed + .00001,
    'taking over a moving AI member retains their stamina rather than refilling it');
  await controls.evaluate(() => {
    const alive = window.__battle.allies.filter(actor => actor.health > 0).length;
    for (let i = 1; i < alive; i++) for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { code: 'KeyY' }));
  });
  data = await controls.evaluate(() => window.__battle);
  assert.equal(data.current, 0);
  assert.ok(data.locomotion.stamina < .15, 'switching back does not refill the exhausted member');
  assert.equal(data.locomotion.speed, 0);
  await controls.waitForTimeout(600);
  assert.ok((await controls.locator('#stamina-label').textContent()).includes('恢复'));
  assert.deepEqual(errors, []);
  const report = {
    note: 'Prototype metre/second tuning, not Enlisted measurements. Lanes are isolated deterministic physics runs, not historical map distances.',
    lanes: ['walk', 'jog', 'sprint'].flatMap(mode => [20, 50].flatMap(distance => [30, 60, 144].map(fps => lane(distance, mode, fps)))),
    realBrowser: { joggingPeak: Math.max(...jogging.map(frame => frame.speed)), sprintingPeak: Math.max(...sprinting.map(frame => frame.speed)), staminaAfterSprint: sprinting.at(-1).stamina, cameraMin: Math.min(...sprinting.map(frame => frame.cameraHeight)), cameraMax: Math.max(...sprinting.map(frame => frame.cameraHeight)) },
    retainedFootstepEvents: footsteps,
  };
  if (artifacts) await writeFile(join(artifacts, 'movement-measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('PASS: weighted movement, actual gait, stamina exhaustion, per-member retention, sprint-to-aim, wall stop, pause, comfort controls and 20m/50m timing.');
} finally {
  if (controlsContext) await controlsContext.close();
  await context.close();
  await browser.close();
}
