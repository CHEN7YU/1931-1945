import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.slitInputReview = {
        start() {
          const wall = world.solids.find(mesh => {
            const p = mesh.userData.parapet;
            return p?.axis === 'x' && Math.abs(p.fixed - 20.9) < .02 &&
              p.min < 0 && p.max > 0;
          });
          if (!wall) throw new Error('Missing main gate south parapet');
          const p = wall.userData.parapet;
          const x = p.openings.reduce((a, b) => Math.abs(a) < Math.abs(b) ? a : b);
          const actor = controlledSoldier(entities);
          actor.position.set(x, p.base, p.fixed - 1.7);
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          actor.heading = controlPose.yaw = Math.PI;
          controlPose.pitch = 0; controlPose.stance = 'standing';
          actor.health = 100000;
          stopLocomotion(actor.locomotion);
          for (const enemy of enemies) { enemy.nextThink = Infinity; enemy.target = null; }
          setGameState('playing'); missionBriefing.hide(); bindControlInput(); updateCamera(0);
          return p;
        },
        snapshot() {
          const actor = controlledSoldier(entities), eye = camera.position;
          return { actor: actor.position.toArray(), eye: eye.toArray(), stance: controlPose.stance,
            yaw: controlPose.yaw,
            eyeInWall: circleBlocked(eye.x, eye.z, .07, world.obstacles, eye.y - .035, .07) };
        },
        prepareTurn() {
          const actor = controlledSoldier(entities);
          actor.position.z = 20.2;
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          actor.heading = controlPose.yaw = 0;
          updateCamera(0);
        },
        turnTowardWall() {
          const sensitivity = lookSensitivity(preferenceValues, { aiming: held.aiming,
            scopeSensitivity: sniperScopeActive() ? infantryWeaponProfile(allies[current].rifle).aimSensitivity : null });
          dispatchControlCommand('look', { x: -Math.PI / sensitivity, y: 0 });
        },
        startStreet() {
          const actor = controlledSoldier(entities);
          actor.position.set(-54, 0, -56);
          actor.position.y = world.walkHeight(actor.position.x, actor.position.z, 0);
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          actor.heading = controlPose.yaw = 0; controlPose.pitch = -.65; controlPose.stance = 'standing';
          stopLocomotion(actor.locomotion);
          updateCamera(0);
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5354/').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const wall = await page.evaluate(() => window.slitInputReview.start());
  await page.keyboard.press('ControlLeft');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');
  await page.waitForTimeout(1000);
  const crouched = await page.evaluate(() => window.slitInputReview.snapshot());
  await page.screenshot({ path: join(directory, 'crouched-slit.png') });
  assert.equal(crouched.stance, 'crouched');
  assert.equal(crouched.eyeInWall, false);
  await page.keyboard.press('KeyZ');
  const blocked = await page.evaluate(() => window.slitInputReview.snapshot());
  assert.equal(blocked.stance, 'crouched', 'do not lie down into the wall');
  await page.keyboard.down('KeyS'); await page.waitForTimeout(2200); await page.keyboard.up('KeyS');
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(1500);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(3500); await page.keyboard.up('KeyW');
  await page.waitForTimeout(1000);
  const prone = await page.evaluate(() => window.slitInputReview.snapshot());
  await page.screenshot({ path: join(directory, 'prone-slit.png') });
  console.log(JSON.stringify({ wall, crouched, blocked, prone }));
  assert.equal(prone.stance, 'prone');
  assert.equal(prone.eyeInWall, false, 'prone eye must stay out of masonry');
  await page.evaluate(() => window.slitInputReview.prepareTurn());
  await page.waitForTimeout(500);
  await page.evaluate(() => window.slitInputReview.turnTowardWall());
  await page.waitForTimeout(1000);
  const turned = await page.evaluate(() => window.slitInputReview.snapshot());
  console.log(JSON.stringify({ turned }));
  assert.ok(turned.yaw > 0 && turned.yaw < Math.PI - .05, 'turn must stop before the prone eye enters the wall');
  assert.equal(turned.eyeInWall, false, 'turning prone must keep the eye out of masonry');
  await page.evaluate(() => window.slitInputReview.startStreet());
  await page.waitForTimeout(1000);
  const streetStart = await page.evaluate(() => window.slitInputReview.snapshot());
  await page.keyboard.down('KeyW');
  try {
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(directory, `street-${i}.png`) });
    }
  } finally { await page.keyboard.up('KeyW'); }
  const streetEnd = await page.evaluate(() => window.slitInputReview.snapshot());
  console.log(JSON.stringify({ streetStart, streetEnd }));
  assert.ok(streetEnd.actor[2] < streetStart.actor[2] - .5, 'walk across the street junction');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
