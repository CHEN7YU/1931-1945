import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { SIHANG_MAP_BOUNDS, SIHANG_BATTLE_AREA, SIHANG_RESERVED_LANES,
  SIHANG_EVACUATION, SIHANG_WAREHOUSE } from '../src/sihang-layout.js';
import { sihangShieldLayout } from '../src/sihang-combat.js';
import { sihangBattleRoster, sihangSpawns } from '../src/sihang-roster.js';
import { formationPositions } from '../src/battle-roster.js';
import { BATTLE_AREA, advanceBoundary, createBoundaryState } from '../src/battle-boundary.js';

let world;
before(() => { world = makeSihangBattlefield(new THREE.Scene(),
  (_kind, color) => new THREE.MeshStandardMaterial({ color })); });

test('six actual frontage buildings replace the oversized clearing while the southern quay stays clear', () => {
  const front = world.town.buildings.filter(b => b.id.startsWith('warehouse-front-'));
  assert.equal(front.length, 6);
  assert.ok(front.every(b => b.bounds.maxZ < SIHANG_WAREHOUSE.minZ));
  assert.ok(front.filter(b => b.z === -54).every(b => b.z + b.depth / 2 === -51));
  const lane = SIHANG_RESERVED_LANES.find(l => l.id === 'sapper-assembly');
  assert.equal(lane.maxX - lane.minX, 7);
  assert.ok(front.every(b => b.bounds.maxX <= lane.minX || b.bounds.minX >= lane.maxX));
  assert.ok(world.town.buildings.every(b => !b.id.startsWith('north-quay') ||
    b.x < SIHANG_WAREHOUSE.minX || b.x > SIHANG_WAREHOUSE.maxX));
});

test('the two rear rows are never generated, including their doors, road and vegetation budget', () => {
  assert.equal(world.town.buildings.some(b => /^concession-(home|interior)-/.test(b.id)), false);
  assert.ok(world.town.buildings.every(b => b.bounds.maxZ <= SIHANG_MAP_BOUNDS.maxZ));
  assert.equal(world.doorSystem.doors.some(d => /^concession-(home|interior)-/.test(d.id)), false);
  assert.equal(world.town.streets.some(s => s.z === 82), false);
  assert.equal(world.sceneArt.city.trees, 7);
  assert.equal(SIHANG_MAP_BOUNDS.maxZ, 74);
});

test('all twenty sappers still spawn and their full five-column shield formation physically traverses the narrower street', () => {
  const spawn = sihangSpawns().find(s => s.id === 'sihang-enemy-9');
  assert.equal(formationPositions(spawn, 20, world.obstacles).length, 20);
  assert.equal(sihangBattleRoster().find(f => f.sihangDemolition).memberCount, 20);
  for (let slot = 0; slot < 20; slot++) {
    const offset = sihangShieldLayout(slot, 20);
    const feet = new THREE.Vector3(offset.x, 0, -72 + offset.z);
    world.moveInfantry(feet, 0, 25.2, .5);
    assert.ok(Math.abs(feet.z - (-46.8 + offset.z)) < .025, `sapper ${slot} is blocked`);
  }
});

test('physical movement and route goals cannot enter cropped terrain, and evacuation remains in bounds', () => {
  const feet = new THREE.Vector3(0, 0, 72);
  world.moveInfantry(feet, 0, 20, .42);
  assert.ok(feet.z > 73 && feet.z <= 73.58);
  assert.deepEqual(world.elevatedPath({ x: 0, y: 0, z: 72 }, { x: 0, y: 0, z: 80 }), []);
  assert.ok(SIHANG_EVACUATION.z + SIHANG_EVACUATION.radius < SIHANG_BATTLE_AREA.maxZ);
  assert.ok(advanceBoundary(createBoundaryState(), { x: 0, z: 73 }, 9, SIHANG_BATTLE_AREA) > 0);
  assert.equal(advanceBoundary(createBoundaryState(), { x: 0, z: 73 }, 9, BATTLE_AREA), 0);
});

test('north damage varies between collapsed wings, missing roofs, facade breaches and genuine shell openings', () => {
  const north = world.town.buildings.filter(building => building.damaged);
  const south = world.town.buildings.filter(building => building.damaged === false);
  assert.equal(north.length, 42); assert.equal(south.length, 13);
  assert.equal(new Set(north.map(home => home.architecture)).size, 5);
  assert.equal(new Set(north.map(home => home.damagePattern)).size, 4);
  assert.ok(Math.max(...north.map(home => home.height)) - Math.min(...north.map(home => home.height)) > 3.5);
  assert.equal(new Set(north.map(home => home.roofForm)).size, 4);
  for (const home of north.filter(home => ['wing-collapse', 'roof-loss'].includes(home.damagePattern))) {
    assert.equal(home.damageStyle, 'collapsed-wall-charred-rafters');
    const ray = new THREE.Raycaster(new THREE.Vector3(home.x + home.width * .28, 2.1,
      home.z + home.depth / 2 + .8), new THREE.Vector3(0, 0, -1), 0, 1.5);
    assert.equal(ray.intersectObjects(world.solids, true).length, 0, `back facade still intact: ${home.id}`);
  }
  for (const home of north.filter(home => home.shellOpening)) {
    const hole = home.shellOpening;
    const ray = new THREE.Raycaster(new THREE.Vector3(hole.x, hole.y, hole.z + .8),
      new THREE.Vector3(0, 0, -1), 0, 1.5);
    assert.equal(ray.intersectObjects(world.solids, true).length, 0, `${home.id}: shell opening is a real hole`);
  }
  assert.ok(south.every(home => !home.damageStyle && !home.collapsedHeight));
  assert.equal(world.sceneArt.city.sootDrawCalls, 1);
});
