import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/src/main.js*', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: await response.text() + `
    const openingRecords = [];
    const originalOpeningSpawn = spawnFormation;
    spawnFormation = function(formation, ...args) {
      const opening = nanjingOpeningEntry(formation);
      if (opening) aiDecisionView.update();
      const occupied = opening && formation.type === 'tank' ? deploymentOccupiedPositions(allForces) : [];
      const success = originalOpeningSpawn(formation, ...args);
      if (opening && success) {
        const vehicles = [...entities.vehicles.values()].filter(vehicle => vehicle.unitId === formation.id && vehicle.health > 0);
        const bodies = vehicles.length ? vehicles.map(vehicle => ({
          x: vehicle.position.x, y: vehicle.position.y + (vehicle.type === 'tank' ? 1.2 : 0),
          z: vehicle.position.z, radius: vehicle.type === 'tank' ? 3.5 : 13
        })) : formation.members.map(actor => ({ x: actor.position.x, y: actor.position.y + 1,
          z: actor.position.z, radius: 1.6 }));
        openingRecords.push({ id: formation.id, kind: formation.type, count: bodies.length,
          start: bodies.map(body => ({ x: body.x, z: body.z })),
          actorIds: formation.members.map(actor => actor.id),
          vehicleIds: vehicles.map(vehicle => vehicle.id),
          clearance: occupied.length ? Math.min(...occupied.map(actor => Math.hypot(
            actor.x - bodies[0].x, actor.z - bodies[0].z))) : null,
          visible: bodies.some(body => aiDecisionView.intersects(body, body.radius)) });
      }
      return success;
    };
    window.openingEntryReview = {
      prepareObserver() {
        const actor = controlledSoldier(entities), x = -24, z = 29;
        const y = world.walkHeight(x, z);
        if (world.isDeepWater(x, z) || circleBlocked(x, z, .43, movementObstacles(x, z), y))
          throw new Error('The opening observer must be on accessible dry ground');
        actor.position.set(x, y, z);
        actor.health = 100000;
        actor.heading = controlPose.yaw = Math.PI;
        controlPose.pitch = -.03;
        stopLocomotion(actor.locomotion);
        updateCamera(0);
      },
      release() {
        for (const civilian of world.civilians.filter(person => person.userData.openingWave))
          civilian.userData.crossedRiver = true;
        updateCamera(0);
        const original = aiDecisionView.intersects;
        aiDecisionView.intersects = () => true;
        try { updateNanjingMission(0); } finally { aiDecisionView.intersects = original; }
      },
      records() { return openingRecords; },
      pending() { return formations.filter(f => f.team === 'enemy' && f.generation === 0)
        .map(f => ({ id: f.id, reason: f.blockedReason })); },
      movement() {
        return openingRecords.map(record => {
          const formation = formations.find(f => f.id === record.id);
          const vehicles = [...entities.vehicles.values()].filter(vehicle => vehicle.unitId === formation.id && vehicle.health > 0);
          const current = vehicles.length ? vehicles.map(vehicle => vehicle.position) : formation.members.map(actor => actor.position);
          return { id: record.id, kind: record.kind, distance: Math.max(0, ...current.map((position, index) =>
            Math.hypot(position.x - record.start[index].x, position.z - record.start[index].z))) };
        });
      },
      visible() {
        if (state !== 'playing') return [];
        camera.updateMatrixWorld(true);
        const found = [];
        for (const record of openingRecords) {
          const formation = formations.find(f => f.id === record.id);
          const vehicles = [...entities.vehicles.values()].filter(v => record.vehicleIds.includes(v.id) && v.health > 0);
          const targets = record.vehicleIds.length
            ? vehicles.map(v => ({ position: v.position.clone(), vehicleId: v.id,
              start: record.start[record.vehicleIds.indexOf(v.id)] }))
            : formation.members.filter(actor => record.actorIds.includes(actor.id) && actor.health > 0)
              .map(actor => ({ position: actor.position.clone().add(new THREE.Vector3(0, 1, 0)), vehicleId: null,
                start: record.start[record.actorIds.indexOf(actor.id)] }));
          for (const target of targets) {
            const projected = target.position.clone().project(camera);
            const distance = Math.hypot(target.position.x - target.start.x, target.position.z - target.start.z);
            if (distance > (record.kind === 'plane' ? 1 : .2) &&
              Math.abs(projected.x) < .95 && Math.abs(projected.y) < .95 &&
              projected.z >= -1 && projected.z <= 1 &&
              hasLine(camera.position, target.position, 300, target.vehicleId)) {
              found.push({ id: record.id, kind: record.kind, time, distance });
              break;
            }
          }
        }
        return found;
      }
    };
  ` });
});
try {
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory&character=procedural',
    process.env.GAME_URL ?? 'http://127.0.0.1:5391').href);
  await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  if (process.env.ENTRY_VISIBLE === '1' && await page.locator('#mission-briefing').isVisible())
    await page.keyboard.press('Enter');
  if (process.env.ENTRY_VISIBLE === '1') await page.evaluate(() => window.openingEntryReview.prepareObserver());
  await page.evaluate(() => window.openingEntryReview.release());
  assert.equal((await page.evaluate(() => window.openingEntryReview.pending())).length, 10,
    'no unit may be forced into view when every position is visible');
  await page.waitForFunction(() => window.openingEntryReview.pending().length === 0,
    null, { timeout: 90000 });
  const records = await page.evaluate(() => window.openingEntryReview.records());
  assert.equal(records.length, 10);
  assert.equal(records.filter(record => record.kind === 'infantry').length, 8);
  assert.equal(records.find(record => record.kind === 'plane')?.count, 3);
  assert.ok(records.every(record => !record.visible), JSON.stringify(records));
  assert.ok(records.filter(record => record.kind === 'infantry').every(record =>
    record.start.every(position => position.z > 65 && position.z <= 96)));
  assert.ok(records.find(record => record.kind === 'tank').clearance >= 4);
  const startedAt = await page.evaluate(() => window.__battle.time);
  await page.waitForFunction(start => window.__battle.time >= start + 5, startedAt, { timeout: 120000 });
  const movement = await page.evaluate(() => window.openingEntryReview.movement());
  assert.ok(movement.some(item => item.kind === 'infantry' && item.distance > .2), JSON.stringify(movement));
  assert.ok(movement.some(item => item.kind === 'plane' && item.distance > 1), JSON.stringify(movement));
  if (process.env.ENTRY_VISIBLE === '1') {
    const seen = new Map(), deadline = Date.now() + 120000;
    while (Date.now() < deadline && !seen.has('infantry') && !seen.has('plane')) {
      for (const entry of await page.evaluate(() => window.openingEntryReview.visible())) seen.set(entry.kind, entry);
      if (!seen.has('infantry') && !seen.has('plane')) await page.waitForTimeout(500);
    }
    assert.ok(seen.size, 'an attacker must actually enter the playing camera view without solid occlusion');
    if (process.env.ENTRY_SCREENSHOT) await page.screenshot({ path: process.env.ENTRY_SCREENSHOT });
    console.log(JSON.stringify({ visibleEntries: [...seen.values()] }));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ records, movement, errors }));
} catch (error) {
  const diagnostic = await page.evaluate(() => ({
    state: window.__battle?.state, time: window.__battle?.time,
    pending: window.openingEntryReview?.pending(), records: window.openingEntryReview?.records()
  }));
  console.error(JSON.stringify({ diagnostic, errors }));
  throw error;
} finally {
  await browser.close();
}
