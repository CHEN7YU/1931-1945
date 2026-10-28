import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { groundHeight } from '../src/ground.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const poseObservations = [];
const canalObservations = [];
const observePose = (stage, data) => poseObservations.push({ stage, control: data.control, stance: data.stance,
  look: data.look, position: data.position, eyeHeight: data.locomotion.eyeHeight, cameraHeight: data.locomotion.cameraHeight,
  binding: data.controlBinding, simulation: data.controlSimulation,
  members: data.allies.map(actor => ({ id: actor.id, stance: actor.stance, lookPitch: actor.lookPitch })) });
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
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
  for (let i = 0; i < 300; i++) {
    const data = await snapshot();
    assert.equal(data.state, 'playing', 'normal movement in the labelled geometry fixture reaches the bridge');
    const dx = x - data.position.x, dz = z - data.position.z, distance = Math.hypot(dx, dz);
    if (distance < .65) break;
    await turnTo(Math.atan2(-dx, -dz));
    await page.waitForTimeout(Math.min(120, Math.max(20, distance / 3.15 * 300)));
  }
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < 1.1, `reached (${x}, ${z}) without teleportation`);
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'bridge'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  const fixture = await snapshot();
  assert.equal(fixture.benchmark?.scenario, 'bridge', 'bridge geometry checks require the explicit development fixture; do not silently test the full battlefield');
  assert.equal(fixture.population.friendly.alive, 5);
  assert.equal(fixture.population.enemy.alive, 0, 'this fixture is for support geometry, not evidence of live combat performance');
  const probes = (await snapshot()).bridgeSurfaces;
  assert.ok(Math.abs(probes.deck - .45) < 1e-6, 'actual 3D bridge ray hit matches its support height');
  assert.ok(Math.abs(probes.northRamp - .225) < 1e-6 && Math.abs(probes.southRamp - .225) < 1e-6, 'visible ramp geometry and the height sampler agree');
  await walkTo(8, -3);
  await walkTo(8, -7.5);
  let data = await snapshot();
  assert.ok(Math.abs(data.position.y - groundHeight(data.position.x, data.position.z)) < 1e-6, 'walking onto the south ramp follows the shared support');
  await walkTo(8, -16);
  data = await snapshot();
  assert.equal(data.position.y, .45);
  await page.keyboard.press('Control');
  await page.waitForFunction(() => Math.abs(window.__battle.locomotion.cameraHeight - window.__battle.position.y - 1.05) < .03);
  data = await snapshot();
  assert.ok(Math.abs(data.locomotion.cameraHeight - .45 - 1.05) < .03, 'crouch eye height starts above the deck');
  await page.keyboard.press('z');
  await page.waitForFunction(() => Math.abs(window.__battle.locomotion.cameraHeight - window.__battle.position.y - .45) < .03);
  data = await snapshot();
  assert.equal(data.stance, 'prone');
  assert.ok(Math.abs(data.locomotion.cameraHeight - .9) < .03, 'prone camera is .45m above the .45m deck, not inside it');
  assert.ok(data.locomotion.cameraHeight - .07 > probes.deck);
  await turnTo(0, -.65);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'bridge-prone.png') });
  }
  await page.keyboard.press('z');
  await page.waitForTimeout(600);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__battle.locomotion.cameraHeight > 2.3);
  await page.keyboard.press('Escape');
  const pausedJump = await snapshot();
  assert.ok(pausedJump.controlSimulation.jumpHeight > 0);
  await page.waitForTimeout(150);
  assert.deepEqual((await snapshot()).controlSimulation, pausedJump.controlSimulation);
  const resumedJump = await page.evaluate(() => {
    document.querySelector('#resume').click();
    return window.__battle;
  });
  assert.equal(resumedJump.controlBinding.changed, false);
  assert.deepEqual(resumedJump.controlSimulation, pausedJump.controlSimulation, 'same-owner resume preserves the frozen mid-air simulation state');
  observePose('jump-resumed-without-owner-change', resumedJump);
  await page.waitForFunction(() => window.__battle.controlSimulation.jumpHeight === 0 &&
    window.__battle.controlSimulation.jumpVelocity === 0 && Math.abs(window.__battle.locomotion.cameraHeight - 2.12) < .03);
  data = await snapshot();
  assert.ok(data.controlEvents.history.some(event => event.type === 'movement.footstep' &&
    event.landing && event.surface === 'stone' && event.soldierId === data.control.soldierId), 'actual landing captures its original soldier and bridge surface');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__battle.controlSimulation.jumpHeight > .2);
  await page.keyboard.press('y');
  data = await snapshot();
  assert.equal(data.controlBinding.changed, true);
  assert.ok(data.controlBinding.previousJumpHeight > .2);
  assert.equal(data.controlBinding.jumpHeight, 0);
  assert.equal(data.controlBinding.jumpVelocity, 0);
  assert.equal(data.controlSimulation.jumpHeight, 0);
  observePose('airborne-member-takeover', data);
  for (let i = 1; i < data.allies.length; i++) await page.keyboard.press('y');
  await walkTo(8, -24.5);
  data = await snapshot();
  assert.ok(Math.abs(data.position.y - groundHeight(data.position.x, data.position.z)) < 1e-6, 'walking down the north ramp keeps continuous support');
  await walkTo(8, -27);
  assert.equal((await snapshot()).position.y, 0, 'leaving the north ramp returns to ordinary ground');
  await walkTo(8, -16);
  await page.keyboard.press('z');
  await turnTo(.3, -.6);
  const original = await snapshot();
  observePose('original-prone', original);
  assert.ok(Math.abs(original.look.pitch + .6) < .002);
  await page.keyboard.press('y');
  data = await snapshot();
  assert.equal(data.stance, 'standing', 'new member does not inherit the old prone selection');
  assert.equal(data.look.pitch, 0, 'new member does not inherit the old look pitch');
  assert.ok(data.allies[data.current].eyeHeight > 1.5);
  assert.ok(Math.abs(data.locomotion.eyeHeight - data.allies[data.current].eyeHeight) < .03,
    'takeover follows the new member standing/leaning height, not the old prone view');
  assert.equal(data.allies[0].manualStance, 'prone', 'AI may stand to follow, but must retain the original manual selection');
  assert.equal(data.allies[0].lookPitch, original.look.pitch);
  observePose('next-member-standing', data);
  assert.ok(Math.abs(data.position.y - groundHeight(data.position.x, data.position.z)) < 1e-6, 'Y changes support height to the newly controlled member immediately');
  assert.ok(data.locomotion.cameraHeight - data.position.y > .37, 'swapping prone members never drops the eyes into the support surface');
  await page.keyboard.press('Control');
  await turnTo(-.4, .2);
  const second = await snapshot();
  assert.ok(Math.abs(second.look.pitch - .2) < .002);
  for (let i = 1; i < original.allies.length; i++) await page.keyboard.press('y');
  data = await snapshot();
  assert.equal(data.current, 0);
  assert.equal(data.stance, 'prone');
  assert.equal(data.look.pitch, original.look.pitch);
  assert.equal(data.locomotion.eyeHeight, data.allies[data.current].eyeHeight);
  assert.ok(data.locomotion.eyeHeight > .37 && data.locomotion.eyeHeight < .52, 'restored prone view uses the real head pose, not the old scalar .45m');
  assert.ok(data.locomotion.cameraHeight - .07 > data.position.y, 'restored prone camera retains clipping clearance above its current support');
  observePose('original-prone-restored', data);
  await page.keyboard.press('y');
  data = await snapshot();
  assert.equal(data.stance, 'crouched');
  assert.equal(data.look.pitch, second.look.pitch);
  observePose('second-crouched-restored', data);
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(150);
  assert.deepEqual((await snapshot()).look, paused.look);
  assert.equal((await snapshot()).stance, paused.stance);
  await page.locator('#back-menu').click();
  await page.locator('#deploy').click();
  data = await snapshot();
  assert.ok(data.allies.every(actor => actor.stance === 'standing' && actor.lookPitch === 0), 'new battle cannot inherit old personal pose state');
  observePose('new-battle-defaults', data);
  assert.equal(data.town.buildings.length, 25);
  assert.equal(data.doors.length, 93);
  const waterfront = data.town.buildings.filter(building => building.riverSide);
  assert.equal(waterfront.length, 8);
  assert.equal(data.staticDamage.craters.length, 5);
  assert.equal(data.staticDamage.ruinedShops.length, 3);
  assert.equal(data.staticDamage.wrecks.length, 3);
  for (const [side, quayZ] of [[-1, -8.1], [1, -25.5]]) {
    await walkTo(8, quayZ);
    for (const building of waterfront.filter(building => building.riverSide === side)) {
      await walkTo(building.x, quayZ);
      await walkTo(building.x, building.z + side * 3);
      data = await snapshot();
      assert.equal(data.town.inside, building.id, 'the river-facing opening enters the real building');
      assert.equal(data.locomotion.surface, 'wood');
      await walkTo(building.x, building.z - side * 3);
      assert.equal((await snapshot()).town.inside, building.id, 'the interior partition is physically traversable');
      if (building.id === 'canal-north-east-home') {
        await turnTo(0, -.75);
        await page.keyboard.press('x');
        await page.waitForFunction(building => window.__battle.allies.some((actor, index) =>
          index !== window.__battle.current && actor.x > building.x - building.w / 2 + .3 &&
          actor.x < building.x + building.w / 2 - .3 && actor.z > building.z - building.d / 2 + .3 &&
          actor.z < building.z + building.d / 2 - .3), building, { timeout: 30000 });
      }
      await walkTo(building.x, building.z + side * 3);
      await walkTo(building.x, quayZ);
      canalObservations.push({ building: building.id, position: (await snapshot()).position });
    }
    if (process.env.ARTIFACT_DIR) {
      await turnTo(Math.PI / 2, -.08);
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, side < 0 ? 'canal-south-quay.png' : 'canal-north-quay.png') });
    }
    await walkTo(8, quayZ);
    if (side < 0) {
      await walkTo(8, -16);
      await turnTo(-Math.PI / 2, -.06);
      if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'canal-waterfront.png') });
    }
  }
  await walkTo(-9.5, -25.5);
  await walkTo(-9.5, -36);
  await walkTo(-14, -36);
  await walkTo(-9.5, -36);
  await walkTo(-5.8, -36);
  await walkTo(-5.8, -25.5);
  await walkTo(-9.5, -25.5);
  await walkTo(-9.5, -36);
  await turnTo(Math.PI, -.12);
  if (process.env.ARTIFACT_DIR) {
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'canal-ruined-courtyard.png') });
    await writeFile(join(process.env.ARTIFACT_DIR, 'canal-observations.json'), JSON.stringify(canalObservations, null, 2));
  }
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'control-pose-observations.json'), JSON.stringify(poseObservations, null, 2));
  assert.deepEqual(errors, []);
  console.log('PASS: labelled development geometry fixture, actual deck/ramp ray heights, two-way walking, crouch/prone clearance, landing, independent member pose restoration, new-battle reset, both quay streets, all eight waterfront buildings and breached ruin courtyard. Full 200-person combat is measured separately.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ current: data?.current, health: data?.health, position: data?.position, stance: data?.stance, locomotion: data?.locomotion }));
  throw error;
} finally {
  await browser.close();
}
