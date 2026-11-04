import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { createNanjingCityLayout, cityStreetIntersectsLot } from '../src/nanjing-city-layout.js';

test('traditional gate lettering and a small roadside temple preserve roads, civilian homes and an enterable doorway', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const plaque = world.solids.find(mesh => mesh.userData.nanjingFeature === 'gate-name-plaque');
  assert.equal(plaque.userData.text, '中華門');
  assert.equal(plaque.material.userData.lettering.order, 'right-to-left');
  assert.equal(plaque.material.userData.lettering.historicalHandwritingReplica, false);
  assert.equal(world.solids.find(mesh => mesh.userData.text === '佛堂').rotation.y, Math.PI);
  const temple = world.landmarks.temple, layout = createNanjingCityLayout();
  assert.ok(temple.fictional && temple.sourceParcelFloors > 1);
  assert.ok(layout.lots.some(lot => lot[0] === temple.x && lot[1] === temple.z));
  assert.ok(layout.streets.every(street => !cityStreetIntersectsLot(
    [temple.x, temple.z, temple.width, temple.depth], street, .65)));
  assert.equal(world.civilians.length, 180);
  assert.ok(world.civilians.every(person => person.userData.homeId !== temple.id));
  const home = world.landmarks.residentialBuildings.find(home => home.id === temple.id);
  assert.equal(home.use, 'temple'); assert.equal(home.floors, 1);
  assert.equal(world.doorSystem.doors.find(door => door.id === `${temple.id}-door`).state, 'open');
  assert.ok(world.solids.some(mesh => mesh.userData.nanjingFeature === 'temple-buddha'));
  assert.ok(world.solids.some(mesh => mesh.userData.nanjingFeature === 'temple-bell'));
  const position = new THREE.Vector3(temple.entry.x, 0, temple.entry.z);
  for (let step = 0; step < 40; step++) world.moveInfantry(position, 0, .05, .4, world.obstacles, 1.75);
  assert.ok(position.z > temple.entry.z + 1.5, 'the player can physically enter the open temple without crossing a wall');
});
