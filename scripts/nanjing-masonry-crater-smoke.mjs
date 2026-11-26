import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const westGate = process.env.REVIEW_WEST_GATE === '1';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 },
    ...(process.env.RECORD_VIDEO === '1' ? { recordVideo: { dir: directory } } : {}) }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.masonryCraterReview = {
        wall() {
          setGameState('pause'); missionBriefing.hide();
          $('hud').hidden = true;
          for (const child of camera.children) child.visible = false;
          const gate = world.landmarks.gatehouse.gates[0];
          if (${westGate}) {
            camera.position.set(-80, 2, -69);
            camera.lookAt(-74.2, 3.2, -63.4);
          } else {
            camera.position.set(25.2, 1.65, gate.z - 2);
            camera.lookAt(23.7, 2.4, gate.z + 1);
          }
          renderer.render(scene, camera);
        },
        crater() {
          setGameState('pause'); missionBriefing.hide();
          const crater = [...world.staticDamage.craters].sort((a, b) =>
            Math.hypot(a.x + 74, a.z + 60) - Math.hypot(b.x + 74, b.z + 60))[0];
          camera.position.set(crater.x + crater.radius * 2.3, 1.15, crater.z + crater.radius * 2.3);
          camera.lookAt(crater.x, -.1, crater.z);
          renderer.render(scene, camera);
          return crater;
        },
        walk() {
          const actor = controlledSoldier(entities), gate = world.landmarks.gatehouse.gates[0];
          if (${westGate}) actor.position.set(-78, 0, -79);
          else actor.position.set(24.6, 0, gate.z - 2);
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          actor.health = 100000;
          actor.heading = controlPose.yaw = ${westGate} ? -Math.PI / 2 : Math.PI / 2;
          controlPose.pitch = 0; controlPose.stance = 'standing';
          stopLocomotion(actor.locomotion);
          for (const enemy of enemies) { enemy.nextThink = Infinity; enemy.target = null; }
          $('hud').hidden = false;
          for (const child of camera.children) child.visible = true;
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        position() { return controlledSoldier(entities).position.toArray(); },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5376/').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => masonryCraterReview.wall());
  await page.screenshot({ path: join(directory, 'wall.png') });
  const crater = await page.evaluate(() => masonryCraterReview.crater());
  await page.screenshot({ path: join(directory, 'crater.png') });
  await page.evaluate(() => masonryCraterReview.walk());
  await page.waitForTimeout(500);
  const start = await page.evaluate(() => masonryCraterReview.position());
  await page.keyboard.down('KeyD');
  try {
    for (let index = 0; index < 5; index++) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(directory, `walk-${index}.png`) });
    }
  } finally { await page.keyboard.up('KeyD'); }
  const end = await page.evaluate(() => masonryCraterReview.position());
  assert.ok(Math.hypot(end[0] - start[0], end[2] - start[2]) > .5, JSON.stringify({ start, end }));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ crater, start, end }));
  const video = page.video();
  if (video) {
    await page.close();
    await video.saveAs(join(directory, 'wall-walk.webm'));
  }
} finally {
  await browser.close();
}
