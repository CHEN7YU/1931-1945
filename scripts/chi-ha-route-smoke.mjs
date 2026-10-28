import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
const out = process.env.ARTIFACT_DIR;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
try {
  await page.route('**/chi-ha-route-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Chi-Ha actual-world routing fixture</title>',
  }));
  await page.goto(new URL('/chi-ha-route-fixture', origin).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { makeWorld } = await import('/src/battlefield.js');
    const { createTankNavigation } = await import('/src/tank-navigation.js');
    const { advanceChiHaAI } = await import('/src/chi-ha-ai.js');
    const { CHI_HA, japaneseArmorSpawns, chiHaObjectiveDestination } = await import('/src/chi-ha.js');
    const { OBJECTIVES, circleBlocked } = await import('/src/core.js');
    const world = makeWorld(new THREE.Scene(), (surface, color, metersPerTile = 2) => {
      const material = new THREE.MeshStandardMaterial({ color });
      Object.assign(material.userData, { surface, metersPerTile });
      return material;
    });
    const navigation = createTankNavigation(world.obstacles);
    const vehicles = japaneseArmorSpawns().map((spawn, index) => ({
      id: `route-${index}`, variant: CHI_HA.id, type: 'tank', team: 'enemy',
      position: new THREE.Vector3(spawn.x, 0, spawn.z), heading: Math.PI, turretYaw: Math.PI,
      turretPitch: 0, health: CHI_HA.health, speed: 0, trackDistance: 0,
      weapon: { settings: CHI_HA, ammo: 1, reloadUntil: 0, nextShot: 0 },
    }));
    const samples = [], reached = [], collisions = [];
    for (let frame = 0; frame < 1000; frame++) {
      const now = frame / 10, objective = OBJECTIVES[now < 30 ? 0 : 1];
      for (const [slot, vehicle] of vehicles.entries()) {
        advanceChiHaAI(vehicle, .1, now, {
          crew: [{ health: 100 }], targets: [], objective, canFire: false,
          destination: chiHaObjectiveDestination(slot, objective),
          visible: () => false, safeToFire: () => false,
          pathTo: (from, to) => navigation.pathTo(vehicle, to, vehicles),
          canTravel: (from, to) => navigation.canTravel(vehicle, from, to, vehicles),
          move: (p, dx, dz) => navigation.move(vehicle, dx, dz, vehicles),
        });
        if (circleBlocked(vehicle.position.x, vehicle.position.z, CHI_HA.clearance, world.obstacles)) {
          collisions.push({ id: vehicle.id, now });
        }
        if (vehicle.ai.distanceToObjective <= objective.radius &&
          !reached.some(visit => visit.id === vehicle.id && visit.objectiveId === objective.id)) {
          reached.push({ id: vehicle.id, objectiveId: objective.id, time: now });
        }
      }
      if (frame % 50 === 0) samples.push({ time: now, tanks: vehicles.map(vehicle => ({
        id: vehicle.id, position: { ...vehicle.position }, tracks: vehicle.trackDistance,
        ai: { ...vehicle.ai, path: vehicle.ai.path.map(point => ({ ...point })) }, navigation: navigation.stats(vehicle),
      })) });
    }
    return { obstacleCount: world.obstacles.length, samples, reached, collisions };
  });
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'chi-ha-routes.json'), JSON.stringify(result, null, 2));
  }
  assert.deepEqual(result.collisions, []);
  for (const id of ['route-0', 'route-1']) {
    assert.ok(result.reached.some(visit => visit.id === id && visit.objectiveId === 'B'),
      `${id} must reach B after the objective changes: ${JSON.stringify(result.samples.at(-1))}`);
  }
  console.log(`PASS: both tanks reach the assigned objective across ${result.obstacleCount} actual battlefield obstacles, including the 30-second objective change.`);
} finally {
  await browser.close();
}
