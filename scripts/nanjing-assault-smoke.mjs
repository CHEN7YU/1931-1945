import { setQualityPreset, deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BATTLE_END_STATES } from '../src/battle-ending.js';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.ARTIFACT_DIR;
const wallRespawnFixture = process.env.WALL_RESPAWN_FIXTURE === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.nanjingAssaultGround = (x, z) => ({
        height: world.groundHeight(x, z), deepWater: world.isDeepWater(x, z)
      });` });
  });
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
  const gameUrl = new URL('/?campaign=nanjing', origin);
  if (process.env.GAME_CHARACTER) gameUrl.searchParams.set('character', process.env.GAME_CHARACTER);
  await page.goto(gameUrl.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  for (const seconds of [10, 30, 60, 90, 120, 180, 240, 300]) {
    await page.waitForFunction(({ seconds, endings }) => window.__battle.time >= seconds ||
      endings.includes(window.__battle.state), { seconds, endings: BATTLE_END_STATES }, { timeout: 360000 });
    const sample = await page.evaluate(() => {
      const battle = window.__battle;
      const units = battle.population.units.filter(unit => unit.team === 'enemy' && unit.type === 'infantry')
        .map(unit => ({ ...unit, members: unit.members.map(member => ({
          ...member, terrain: window.nanjingAssaultGround(member.x, member.z),
        })) }));
      return {
        time: battle.time, state: battle.state, campaign: battle.campaign,
        units,
        belowZero: units.flatMap(unit => unit.members.filter(member => member.y < 0).map(member => ({
          unit: unit.id, x: member.x, y: member.y, z: member.z,
          ...member.terrain,
        }))),
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
      crossed: sample.units.filter(unit => unit.members.some(member => member.z < 38)).length,
      refugeesCrossed: sample.campaign.civiliansCrossedRiver,
      assaultReleased: sample.campaign.openingAssaultReleased }));
    if (BATTLE_END_STATES.includes(sample.state)) break;
    if (wallRespawnFixture && seconds >= 120) break;
    if (seconds >= 180 && samples.some(sample => sample.units.some(unit => unit.members.some(member => member.z < 15.2))) &&
      samples.some(sample => sample.vehicles.some(vehicle => vehicle.position.z < 38))) break;
  }
  const held = samples.filter(sample => !sample.campaign.openingAssaultReleased);
  assert.ok(held.length, 'the opening must begin with the attackers in reserve');
  assert.ok(held.every(sample => sample.units.every(unit => unit.members.length === 0) &&
    sample.campaign.airSupport.count === 0 && sample.campaign.stageElapsed === 0),
    'infantry and aircraft must remain in reserve without consuming defense time');
  assert.ok(samples.some(sample => sample.campaign.openingAssaultReleased),
    'the Japanese assault must release after the opening refugees finish crossing');
  const firstWave = samples.find(sample => sample.units.length === 8 &&
    sample.units.every(unit => unit.members.length > 0));
  assert.ok(firstWave, 'all eight Japanese squads must spawn after the opening evacuation');
  assert.ok(firstWave.units.every(unit => unit.members.every(member =>
    member.spawnPosition.z > 65 && member.spawnPosition.z <= 96)),
    'the opening Japanese assault must spawn south of the river and within the battle boundary');
  const movingWave = samples.find(sample => sample.units.length === 8 && sample.units.every(unit =>
    unit.members.some(member => Math.hypot(member.x - member.spawnPosition.x,
      member.z - member.spawnPosition.z) > 8)));
  assert.ok(movingWave, 'all eight Japanese squads must leave their southern starting positions');
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
    unit.members.every(member => member.y + .05 >= member.terrain.height &&
      (member.y >= 0 || !member.terrain.deepWater) &&
      (!member.terrain.deepWater || (member.z > 39 && member.z < 65 && Math.abs(member.x + 24) < 5)) &&
      (member.z <= 39 || member.z >= 65 || Math.abs(member.x + 24) < 5)))),
  'all eight Japanese squads must use the bridge without passing below the ground or wading in deep water');
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
