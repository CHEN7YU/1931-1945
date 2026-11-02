import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { beginCivilianStreetEvacuation, resetCivilianStreetLife, updateCivilianStreetLife } from '../src/civilian-street-life.js';
import { releaseNanjingCivilianWave } from '../src/civilian-crowd.js';

test('street residents use real doors, return inside and rejoin evacuation without moving or changing the total', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const people = world.civilians.filter(person => person.userData.streetLife);
  let maxStep = 0;
  for (let frame = 0; frame < 3600; frame++) {
    const peers = people.filter(person => person.visible);
    world.doorSystem.update(.05, peers.map(person => ({ ...person.position, radius: .36 })));
    for (const person of people) {
      const before = person.position.clone();
      updateCivilianStreetLife(person, frame * .05, .05, peers, world.doorSystem);
      maxStep = Math.max(maxStep, before.distanceTo(person.position));
    }
  }
  assert.ok(maxStep < .09, 'going home must not teleport or snap across the doorway');
  assert.ok(people.every(person => person.userData.streetLife.cycles > 0));
  assert.ok(people.every(person => !person.userData.active && !person.userData.arrived));
  releaseNanjingCivilianWave(world.civilians, 180);
  for (const person of people) {
    const before = person.position.clone();
    assert.ok(person.userData.releaseAt >= 180 && person.userData.releaseAt < 187);
    beginCivilianStreetEvacuation(person);
    assert.equal(before.distanceTo(person.position), 0);
    assert.ok(person.userData.streetEvacuating && person.userData.route.length > 2);
  }
  assert.equal(world.civilians.length, 180);
  world.resetCampaign();
  for (const person of people) {
    const street = person.userData.streetLife;
    assert.equal(street.cycles, 0);
    assert.equal(street.waypoint, street.initialWaypoint);
    assert.equal(person.userData.streetEvacuating, false);
    assert.equal(person.userData.releaseAt, Infinity);
    assert.equal(person.userData.route, person.userData.homeRoute);
    const before = person.position.clone();
    resetCivilianStreetLife(person);
    assert.equal(person.position.distanceTo(before), 0);
  }
});
