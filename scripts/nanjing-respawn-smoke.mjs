import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deploymentMapView, deploymentMapPoint } from '../src/deployment-map.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.respawnReview = {
        prepare() {
          updateAI = () => {};
          for (const plane of world.aircraft ?? []) plane.userData.attack.cooldown = 10000;
          for (const actor of allies) actor.health = 0;
          for (const actor of enemies) actor.health = 0;
          const enemy = enemies.find(actor => !actor.vehicleId);
          enemy.health = 100;
          const ground = spawnPoints.find(point => point.id === (nanjingCampaignMode ? 'nanjing-gate' : 'china-base'));
          enemy.position.set(ground.x, 0, ground.z);
          rebuildForces();
          showOverlay('dead');
        },
        enemyOnWall() {
          const point = spawnPoints.find(point => point.id === 'nanjing-gate-north-wall');
          const enemy = enemies.find(actor => actor.health > 0);
          enemy.position.set(point.x, point.altitude, point.z);
          refreshDeployment();
        },
        enemyOnGround() {
          const point = spawnPoints.find(point => point.id === 'nanjing-gate');
          const enemy = enemies.find(actor => actor.health > 0);
          enemy.position.set(point.x, 0, point.z);
          refreshDeployment();
        },
        snapshot() {
          return { state, spawnId: unit.spawnId, pendingSpawn, count: allies.length,
            soldiers: allies.map(actor => ({ health: actor.health, y: actor.position.y })),
            layout: ['redeploy-choices', 'deployment-map', 'spawn-choices', 'confirm-deploy'].map(id =>
              ({ id, tag: document.getElementById(id).tagName, className: document.getElementById(id).className })) };
        },
      };
    ` });
  });
  const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
  let sharedLayout;
  for (const campaign of ['', '?campaign=nanjing']) {
    await page.goto(origin + '/' + campaign);
    await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
    await page.locator('#menu-quality').selectOption('low');
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing');
    await page.evaluate(() => respawnReview.prepare());
    await page.locator('#redeploy-choices [data-type="infantry-reserve"]').click();
    const mapLayout = await page.locator('#deployment-map').boundingBox();
    const squadsLayout = await page.locator('#redeploy-choices').boundingBox();
    assert.ok(mapLayout.width >= 350, 'deployment uses a prominent map, not a minimap thumbnail');
    assert.ok(mapLayout.x + mapLayout.width <= squadsLayout.x, 'squad controls sit beside the map');
    const snapshot = await page.evaluate(() => respawnReview.snapshot());
    if (!campaign) {
      sharedLayout = snapshot.layout;
      assert.equal(await page.locator('[data-spawn="china-base"]').isDisabled(), true);
      continue;
    }
    assert.deepEqual(snapshot.layout, sharedLayout, 'both maps use the same deployment controls');
    const ground = page.locator('[data-spawn="nanjing-gate"]');
    const wall = page.locator('[data-spawn="nanjing-gate-north-wall"]');
    assert.equal(await page.locator('#spawn-choices button').count(), 2);
    assert.equal(await ground.isDisabled(), true);
    assert.match(await ground.textContent(), /附近有敌军/);
    assert.equal(await wall.isDisabled(), false);
    assert.equal(snapshot.pendingSpawn, 'nanjing-gate-north-wall', 'choose the safe alternative automatically');
    await page.evaluate(() => respawnReview.enemyOnWall());
    assert.equal(await wall.isDisabled(), true);
    assert.equal(await page.locator('#confirm-deploy').isDisabled(), true);
    await page.evaluate(() => respawnReview.enemyOnGround());
    await wall.click();
    const map = page.locator('#deployment-map');
    const rect = await map.boundingBox();
    const [px, pz] = deploymentMapPoint(deploymentMapView('gate-defense'), 0, -6.0666666667);
    assert.equal(await map.getAttribute('data-map-span'), '76');
    await map.click({ position: { x: px / 176 * rect.width, y: pz / 176 * rect.height } });
    assert.equal(await wall.getAttribute('aria-pressed'), 'true');
    if (process.env.RESPAWN_SCREENSHOT) await page.screenshot({ path: process.env.RESPAWN_SCREENSHOT });
    await page.locator('#confirm-deploy').click();
    await page.waitForFunction(() => window.__battle?.state === 'playing');
    const deployed = await page.evaluate(() => respawnReview.snapshot());
    assert.equal(deployed.spawnId, 'nanjing-gate-north-wall');
    assert.equal(deployed.count, 11);
    assert.ok(deployed.soldiers.every(actor => actor.health > 0 && Math.abs(actor.y - 8.58) < .02));
  }
  assert.deepEqual(errors, []);
  console.log('Shared deployment UI, blocked ground spawn, selectable northern wall, wall-enemy blocking and eleven-person wall respawn passed.');
} finally {
  await browser.close();
}
