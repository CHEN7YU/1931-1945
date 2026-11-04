import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.ARTIFACT_DIR;
const wallRespawnFixture = process.env.WALL_RESPAWN_FIXTURE === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  if (wallRespawnFixture) {
    // Place one AI squad on the rampart to isolate its defensive firing behavior.
    await page.route('**/src/battle-roster.js', async route => {
      const response = await route.fetch(), body = await response.text();
      const opening = 'openingSpawnId: index < 3 ? `nanjing-gate-front-${index}` : null,';
      assert.ok(body.includes(opening), 'the wall fixture must replace exactly the opening-spawn selection');
      await route.fulfill({ response, body: body.replace(opening,
        "openingSpawnId: index === 1 ? 'nanjing-gate-wall' : index < 3 ? `nanjing-gate-front-${index}` : null,") });
    });
  }
  await page.goto(new URL('/?campaign=nanjing', origin).href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', undefined, { timeout: 60000 });
  await page.locator('#menu-quality').selectOption('low');
  await deployFromMenu(page);
  for (const seconds of [15, 35, 60, 90, 120, 180]) {
    await page.waitForFunction(seconds => window.__battle.time >= seconds, seconds, { timeout: 150000 });
    const sample = await page.evaluate(() => {
      const battle = window.__battle;
      return {
        time: battle.time, state: battle.state, campaign: battle.campaign,
        units: battle.population.units.filter(unit => unit.team === 'enemy' && unit.type === 'infantry'),
        vehicles: battle.vehicles.map(vehicle => ({
          position: vehicle.position, ai: vehicle.ai, trackDistance: vehicle.trackDistance,
        })),
        enemies: battle.enemyPositions,
        wallDefenders: battle.friendlyPositions.filter(actor => actor.formationId === 'friendly-1'),
      };
    });
    samples.push(sample);
    console.log(JSON.stringify({ time: sample.time, state: sample.state,
      squadsMoving: sample.units.filter(unit => unit.members.some(member =>
        Math.hypot(member.x - member.spawnPosition.x, member.z - member.spawnPosition.z) > 8)).length,
      crossed: sample.units.filter(unit => unit.members.some(member => member.z < 38)).length }));
    if (wallRespawnFixture && seconds >= 120) break;
    if (seconds >= 90 && samples.some(sample => sample.units.some(unit => unit.members.some(member => member.z < 15.2))) &&
      samples.some(sample => sample.vehicles.some(vehicle => vehicle.position.z < 38))) break;
  }
  const firstWave = samples[2];
  if (wallRespawnFixture) {
    const firedWallActors = new Set(samples.flatMap(sample => sample.wallDefenders
      .filter(actor => actor.y > 8 && actor.rifle.shots > 0).map(actor => actor.soldierId)));
    assert.ok(firedWallActors.size >= 4, 'multiple rampart defenders must fire during the opening attack');
  }
  assert.equal(firstWave.units.length, 8);
  assert.ok(samples.some(sample => sample.campaign.airSupport.count === 3 &&
    sample.campaign.airSupport.aircraft.every(plane => plane.shots > 0 && plane.lastShot)),
  'all three circling aircraft must fire through the shared weapon path');
  assert.ok(samples.every(sample => sample.units.every(unit => unit.assaultCrossing === 'bridge' &&
    unit.members.every(member => member.y >= 0 &&
      (member.z <= 39 || member.z >= 65 || Math.abs(member.x + 24) < 5)))),
  'all eight Japanese squads must use the bridge without wading or standing in deep water');
  assert.ok(firstWave.units.every(unit => unit.members.some(member =>
    Math.hypot(member.x - member.spawnPosition.x, member.z - member.spawnPosition.z) > 8)),
  'all eight Japanese squads must actually leave their starting positions');
  if (!wallRespawnFixture) {
    assert.ok(samples.some(sample => sample.units.some(unit => unit.members.some(member => member.z < 38))),
      'Japanese infantry must physically cross the Yuhua Road bridge');
    assert.ok(samples.some(sample => sample.units.some(unit => unit.members.some(member => member.z < 15.2))),
      'Japanese infantry must physically enter the barbican through the main gate');
    assert.ok(samples.some(sample => sample.vehicles.some(vehicle => vehicle.trackDistance > 10)),
      'Japanese armor should leave its southern staging point');
    assert.ok(samples.some(sample => sample.vehicles.some(vehicle => vehicle.position.z < 38)),
      'Japanese armor must continue past the bridge approach waypoint');
  }
  assert.deepEqual(errors, []);
} finally {
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, 'nanjing-assault.json'), JSON.stringify({ wallRespawnFixture, samples, errors }, null, 2));
    await page.screenshot({ path: join(artifacts, 'nanjing-assault.png') });
  }
  await browser.close();
}
