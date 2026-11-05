import { setQualityPreset, deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.descentReview = {
        prepare() {
          for (const plane of world.aircraft) plane.userData.attack.cooldown = 10000;
          for (const actor of enemies) actor.health = 0;
          for (const formation of formations.filter(formation => formation.team === 'enemy')) formation.evacuated = true;
          nanjingCampaign.reinforcementStopped = true;
          for (const actor of friendlyAI) actor.health = 0;
          for (const formation of formations.filter(formation => !formation.player && formation.team === 'friendly'))
            formation.evacuated = true;
          enemies = []; rebuildForces();
          for (const actor of allies) actor.health = 0;
          showOverlay('dead');
        },
        order(kind) {
          const spawn = spawnPoints.find(point => point.id === 'nanjing-gate-north-wall');
          const positions = formationPositions(spawn, 11, deploymentObstacles());
          for (const [index, actor] of allies.entries()) {
            actor.position.set(positions[index].x, spawn.altitude, positions[index].z);
            actor.order = kind;
            actor.orderObjectiveId = kind === 'advance' ? 'gate' : null;
            actor.orderPoint = kind === 'hold' ? { ...actor.position } : { x: -6.2, y: 0, z: 0 };
            actor.target = null; actor.tactics.lastSeen = null;
            actor.tactics.personalSlot = null;
            actor.path = actor.pathGoal = null; pathRequests.delete(actor.tactics.id);
          }
          if (kind === 'follow') allies[current].position.set(-6.2, 0, 0);
          return time;
        },
        snapshot() {
          return { time, actors: allies.filter(actor => actor !== allies[current]).map(actor => ({
            x: actor.position.x, y: actor.position.y, z: actor.position.z,
            mode: actor.tactics.mode, order: actor.order, health: actor.health,
            stance: actor.stance, postureReady: postureReady(actor), heading: actor.heading,
            turning: actor.turningToPath, speed: actor.locomotion.speed,
            exit: nanjingWallExitWaypoint(actor.position),
          })) };
        },
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  await page.evaluate(() => descentReview.prepare());
  await page.locator('#redeploy-choices [data-type="infantry-reserve"]').click();
  await page.locator('[data-spawn="nanjing-gate-north-wall"]').click();
  await page.locator('#confirm-deploy').click();
  for (const order of ['hold', 'advance', 'follow']) {
    const started = await page.evaluate(kind => descentReview.order(kind), order);
    await page.waitForFunction(({ started, order }) => {
      const data = descentReview.snapshot();
      return order === 'hold' ? data.time > started + 3 :
        data.time > started + 100 || data.actors.every(actor => actor.y <= .025 && !actor.exit) &&
          (order === 'follow' || data.actors.every(actor => Math.hypot(actor.x + 6.2, actor.z) < 7));
    }, { started, order }, { timeout: 240000 });
    const result = await page.evaluate(() => descentReview.snapshot());
    assert.equal(result.actors.length, 10);
    if (order === 'hold') assert.ok(result.actors.every(actor => actor.y > 8.4),
      'holding on the rampart must not force a descent');
    else assert.ok(result.actors.every(actor => actor.y <= .025 &&
      (order === 'follow' || Math.hypot(actor.x + 6.2, actor.z) < 7)),
      `${order}: all ten squadmates must physically descend and reach the ground order: ${JSON.stringify(result)}`);
    console.log(JSON.stringify({ order, seconds: result.time - started, actors: result.actors }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
