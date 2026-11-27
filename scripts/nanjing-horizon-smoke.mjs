import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.horizonReview = {
        prepare() {
          setGameState('pause'); missionBriefing.hide();
          const actor = controlledSoldier(entities), point = emplacements.get('gate-wall-mg');
          const pose = emplacementPose(point, point.altitude).operator;
          actor.position.set(pose.x, pose.y, pose.z);
          actor.nativeMotion.position = { x: pose.x, z: pose.z };
          actor.health = 100000;
          for (const enemy of enemies) { enemy.nextThink = Infinity; enemy.target = null; }
          controlPose.yaw = point.heading; controlPose.pitch = -.6; controlPose.stance = 'standing';
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        mounted() { return controlledSoldier(entities).emplacementId; },
        capture(waterVisible) {
          setGameState('pause');
          controlPose.pitch = -.15; updateCamera(0);
          const water = scene.children.filter(child => child.userData.nanjingFeature === 'river-water');
          water.forEach(mesh => { mesh.visible = waterVisible; });
          camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          return { position: camera.position.toArray(), direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
            fov: camera.fov, waterCount: water.length };
        },
        probe(x, y) {
          scene.updateMatrixWorld(true);
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
          return ray.intersectObjects(scene.children.filter(child =>
            ['river-water', 'dry-ground-surface', 'north-distant-ground', 'south-distant-ground'].includes(child.userData.nanjingFeature)), false)
            .slice(0, 5).map(hit => ({ feature: hit.object.userData.nanjingFeature,
              distance: hit.distance, point: hit.point.toArray() }));
        },
      };` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5376/').href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => horizonReview.prepare());
  await page.locator('#world').click();
  await page.keyboard.press('f');
  await page.waitForFunction(() => horizonReview.mounted() === 'gate-wall-mg', null, { timeout: 10000 });
  const view = await page.evaluate(() => horizonReview.capture(true));
  const rays = await page.evaluate(() => [[.42, .505], [.44, .508], [.46, .51], [.48, .515]]
    .map(([x, y]) => ({ x, y, hits: horizonReview.probe(x, y) })));
  assert.equal(view.waterCount, 2);
  await page.screenshot({ path: join(directory, 'original.png') });
  await page.evaluate(() => horizonReview.capture(false));
  await page.screenshot({ path: join(directory, 'without-water.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ view, rays, errors }, null, 2));
  console.log(JSON.stringify({ view, rays, errors }));
} finally {
  await browser.close();
}
