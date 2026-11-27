import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  if (process.env.COMBAT_REFERENCE === '1') {
    await page.route('**/src/war-damage.js*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      assert.ok(body.includes('const visual = addTankWreckVisual(root);'));
      await route.fulfill({ response, body: body.replace('const visual = addTankWreckVisual(root);',
        'const visual = new THREE.Group();') });
    });
  }
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.staticTankReview = (x, z) => {
        setGameState('pause'); missionBriefing.hide();
        const wreck = world.staticDamage.wrecks.find(item => item.id === 'wreck-north-light-tank');
        if (!wreck) throw new Error('Missing Taierzhuang tank wreck');
        if (${process.env.COMBAT_REFERENCE === '1'}) {
          let tank = [...entities.vehicles.values()].find(item => item.type === 'tank' && item.team === 'enemy');
          if (!tank) throw new Error('Missing Japanese combat tank');
          if (tank.health > 0) {
            tank.position.set(wreck.x, world.groundHeight(wreck.x, wreck.z), wreck.z);
            tank.heading = wreck.heading; tank.turretYaw = wreck.heading;
            damageVehicle(tank, tank.health, captureAttackSource(entities, controlledSoldier(entities)), 'cannon');
          }
          vehicleRenderer.update(entities.vehicles.values(), time);
        }
        const actor = controlledSoldier(entities);
        actor.position.set(x, world.groundHeight(x, z), z);
        if (actor.nativeMotion) actor.nativeMotion.position = { x, z };
        stopLocomotion(actor.locomotion);
        controlPose.yaw = Math.atan2(x - wreck.x, z - wreck.z);
        controlPose.pitch = -.08;
        updateCamera(0);
        renderer.render(scene, camera);
        let tankVisual;
        scene.traverse(object => { if (object.userData.staticTankVisual) tankVisual = object; });
        if (!tankVisual && !${process.env.COMBAT_REFERENCE === '1'}) throw new Error('Missing static tank visual');
        const visibleDraws = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        let hiddenDraws = null;
        if (tankVisual) {
          tankVisual.visible = false;
          renderer.render(scene, camera);
          hiddenDraws = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
          tankVisual.visible = true;
          renderer.render(scene, camera);
        }
        const origin = new THREE.Vector3(wreck.x - 5, world.groundHeight(wreck.x, wreck.z) + .75, wreck.z);
        const direction = new THREE.Vector3(1, 0, 0);
        const probe = new THREE.Raycaster(origin, direction, 0, 8);
        const candidates = solidIndex.candidates(origin, direction, 8);
        const wreckSolids = candidates.filter(item => item.parent?.userData.staticWreckId === 'north-light-tank');
        const wreckHits = probe.intersectObjects(wreckSolids, false);
        return { x, z, wreck, wreckSolids: wreckSolids.length, wreckHits: wreckHits.length,
          visibleDraws, hiddenDraws };
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'taierzhuang-streets');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const views = [{ name: 'north-west', x: 6, z: -35 }, { name: 'south-west', x: 6, z: -46 }];
  const results = [];
  for (const view of views) {
    const result = await page.evaluate(({ x, z }) => staticTankReview(x, z), view);
    assert.ok(result.wreckSolids > 0 && result.wreckHits > 0, 'tank hull remains in the gameplay projectile index');
    results.push(result);
    await page.screenshot({ path: join(directory, `${view.name}.png`) });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ views: results, errors,
    limitation: process.env.COMBAT_REFERENCE === '1'
      ? 'Low-quality gameplay diagnostic: static appearance suppressed, enemy tank relocated and damage applied directly.'
      : 'Low-quality gameplay diagnostic: paused and player placed at the listed coordinates.' }, null, 2));
} finally {
  await browser.close();
}
