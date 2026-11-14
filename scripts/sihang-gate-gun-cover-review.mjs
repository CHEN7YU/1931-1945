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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.gateGunCoverReview = {
        setup(id) {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          if (actor.emplacementId) releaseEmplacement(actor, false);
          if (point.operatorId) {
            const operator = entities.soldiers.get(point.operatorId);
            if (operator) releaseEmplacement(operator, false);
          }
          const pose = emplacementPose(point, point.altitude);
          actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          controlPose.yaw = point.heading; controlPose.pitch = 0;
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        sample(id) {
          const point = emplacements.get(id), actor = controlledSoldier(entities);
          const pose = emplacementPose(point, point.altitude);
          const origin = new THREE.Vector3(pose.muzzle.x, pose.muzzle.y, pose.muzzle.z);
          const direction = new THREE.Vector3(-Math.sin(point.yaw), 0, -Math.cos(point.yaw));
          ray.set(origin, direction); ray.far = 10;
          const hits = ray.intersectObjects(solidIndex.candidates(origin, direction, 10)
            .filter(object => object.userData.emplacementId !== id || object.userData.emplacementCover), true)
            .slice(0, 3).map(hit => ({distance: hit.distance, point: hit.point.toArray(),
              name: hit.object.name, feature: hit.object.userData.sihangFeature ?? null}));
          ray.far = Infinity;
          let coverMeshes = 0;
          point.view.traverse(object => { if (object.isMesh && object.userData.emplacementCover) coverMeshes++; });
          const coverObstacles = world.obstacles.filter(obstacle => obstacle.id?.startsWith(id + ':obstacle-'));
          return { mounted: actor.emplacementId, shots: point.shots, coverMeshes,
            coverObstacles: coverObstacles.length, hits };
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const results = [];
  for (const id of ['sihang-north-gate-west', 'sihang-north-gate-east']) {
    await page.evaluate(id => gateGunCoverReview.setup(id), id);
    await page.locator('#world').click();
    await page.keyboard.press('f');
    await page.waitForFunction(id => gateGunCoverReview.sample(id).mounted === id, id, { timeout: 20000 });
    await page.screenshot({ path: join(directory, id + '.png') });
    const before = await page.evaluate(id => gateGunCoverReview.sample(id), id);
    assert.ok(before.coverMeshes > 0, JSON.stringify({ id, before }));
    assert.ok(before.coverObstacles >= 4, JSON.stringify({ id, before }));
    assert.ok(before.hits.every(hit => hit.distance > 2), JSON.stringify({ id, before }));
    await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
    const after = await page.evaluate(id => gateGunCoverReview.sample(id), id);
    assert.ok(after.shots > before.shots, JSON.stringify({ id, before, after }));
    results.push({ id, before, after });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'gate-gun-cover.json'), JSON.stringify({
    fixture: 'Production Sihang scene; player placed at each gun, enemies disabled, actual F and mouse input.',
    results, errors,
  }, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
