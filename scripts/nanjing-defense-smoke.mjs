import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'if (actor === player) {';
    assert.ok(source.includes(marker));
    await route.fulfill({ response, body: source.replace(marker,
      'if (actor.fixtureTarget) continue; ' + marker) + `
      let fixtureTarget;
      window.defenseReview = {
        isolate() {
          for (const plane of world.aircraft) plane.userData.attack.cooldown = 10000;
          fixtureTarget = enemies.find(actor => !actor.vehicleId);
          for (const actor of enemies) actor.health = 0;
          for (const formation of formations.filter(item => item.team === 'enemy')) formation.evacuated = true;
          enemies = []; rebuildForces();
          for (const actor of allies) actor.position.set(0, 0, -13 - actor.index * 1.5);
        },
        target(inside = false) {
          fixtureTarget.health = 100000;
          fixtureTarget.fixtureTarget = true;
          fixtureTarget.position.set(inside ? 0 : -24, 0, inside ? 12 : 38);
          enemies = [fixtureTarget]; rebuildForces();
          return time;
        },
        snapshot() {
          return { time, stage: nanjingCampaign.stage, actors: friendlyAI.filter(actor => actor.health > 0).map(actor => ({
            id: actor.id, x: actor.position.x, y: actor.position.y, z: actor.position.z,
            duty: actor.tactics.nanjingDefense, mode: actor.tactics.mode,
            goal: formationDestination(actor, objectives[0]), path: actor.path, shots: actor.rifle.shots,
          })) };
        },
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#menu-quality').selectOption('low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  await page.evaluate(() => defenseReview.isolate());
  await page.waitForFunction(() => {
    const data = defenseReview.snapshot();
    return data.time > 130 || data.actors.filter(actor => actor.duty?.role === 'wall' &&
      actor.y > 8.4 && Math.hypot(actor.x - actor.goal.x, actor.z - actor.goal.z) < 1.2).length === 8;
  }, null, { timeout: 240000 });
  const data = await page.evaluate(() => defenseReview.snapshot());
  assert.equal(data.actors.filter(actor => actor.duty?.role === 'wall' && actor.y > 8.4 &&
    Math.hypot(actor.x - actor.goal.x, actor.z - actor.goal.z) < 1.2).length, 8,
  'eight AI soldiers must reach separated wall posts: ' + JSON.stringify(data));
  assert.equal(data.actors.filter(actor => actor.duty?.role !== 'wall' && actor.y < .3).length, 14,
    'courtyard and reserve defenders must remain on the ground');
  const started = await page.evaluate(() => defenseReview.target());
  await page.waitForFunction(started => {
    const data = defenseReview.snapshot();
    return data.time > started + 30 || data.actors.filter(actor => actor.y > 8.4 && actor.shots > 0).length >= 4;
  }, started, { timeout: 90000 });
  const combat = await page.evaluate(() => defenseReview.snapshot());
  assert.ok(combat.actors.filter(actor => actor.y > 8.4 && actor.shots > 0).length >= 4,
    'wall defenders must actually fire through the shared rifle path: ' + JSON.stringify(combat));
  const shotsBefore = Object.fromEntries(combat.actors.map(actor => [actor.id, actor.shots]));
  const breachedAt = await page.evaluate(() => defenseReview.target(true));
  await page.waitForFunction(({ breachedAt, shotsBefore }) => {
    const data = defenseReview.snapshot();
    return data.time > breachedAt + 30 || data.actors.filter(actor => actor.y > 8.4 &&
      actor.goal.z < 18 && actor.shots > shotsBefore[actor.id]).length >= 2;
  }, { breachedAt, shotsBefore }, { timeout: 90000 });
  const interior = await page.evaluate(() => defenseReview.snapshot());
  assert.ok(interior.actors.filter(actor => actor.y > 8.4 &&
    actor.goal.z < 18 && actor.shots > shotsBefore[actor.id]).length >= 2,
  'wall defenders must turn inward and shoot actual intruders in the barbican: ' + JSON.stringify(interior));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ arrivalTime: data.time,
    wallDefenders: data.actors.filter(actor => actor.y > 8.4).length,
    groundDefenders: data.actors.filter(actor => actor.y < .3).length,
    firingWallDefenders: combat.actors.filter(actor => actor.y > 8.4 && actor.shots > 0).length,
    inwardFiringDefenders: interior.actors.filter(actor => actor.y > 8.4 &&
      actor.goal.z < 18 && actor.shots > shotsBefore[actor.id]).length, errors }));
} finally {
  await browser.close();
}
