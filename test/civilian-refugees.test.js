import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeRefugeeRestGroups, resetCivilianFlight, advanceCivilianFlight, civilianBodyHeight } from '../src/civilian-refugees.js';
import { createCivilianCharacterFactory, updateCivilianAppearance } from '../src/civilian-character.js';
import { advanceCivilianMotion } from '../src/civilian-motion.js';
import { civilianAimHeight } from '../src/civilian-targets.js';
import { createCivilianVoiceDirector } from '../src/civilian-voices.js';
import { traceCivilianBullet } from '../src/civilian-hits.js';

test('rest placements contain all sixty refugees in varied three-to-five person roadside groups', () => {
  const street = { width: 4.8, points: [[0, -12], [0, -70]] };
  const route = [{ x: 0, z: -12 }, { x: 0, z: -66 }];
  const places = placeRefugeeRestGroups([street], route, [], { at: () => [] });
  assert.equal(places.length, 60);
  const groups = new Map();
  for (const point of places) {
    groups.set(point.group, (groups.get(point.group) ?? 0) + 1);
    assert.ok(Math.abs(point.x) >= 2.6);
    assert.ok(point.connection.distance <= 8);
    assert.ok(point.connection.distance >= 1.1);
  }
  for (const point of places)
    assert.ok(places.every(other => other === point ||
      Math.hypot(point.x - other.x, point.z - other.z) >= 1.25));
  assert.ok([...groups.values()].every(size => size >= 3 && size <= 5));
  assert.equal(new Set(places.map(point => point.pose)).size, 4);
  assert.ok(places.some(point => point.x < 0) && places.some(point => point.x > 0));
});

test('gate defense never sends rested refugees or residents to the dock; encounter release is local and dock arrival completes the wave', () => {
  const state = {}; resetCivilianFlight(state);
  const person = (id, x, refugee) => ({ visible: refugee, position: { x, y: 0, z: -18 },
    userData: { civilianId: id, openingWave: refugee, resting: refugee, restGroup: id < 3 ? 0 : 1,
      refugeeRestPoint: refugee ? { x, z: -18 } : null,
      flightReleaseAt: null, releaseAt: Infinity, fleeReleased: false, waypoint: 2,
      refugeeRestRoute: [{ x, z: -12 }, { x, z: -16 }, { x, z: -18 }],
      refugeeResumeRoute: [{ x, z: -16 }, { x: -65, z: -80 }], homeRoute: [{ x, z: -18 }, { x: -65, z: -80 }] } });
  const civilians = [person(0, 0, true), person(1, 1, true), person(2, -1, true), person(3, 40, true), person(60, 60, false)];
  const player = { x: 0, y: 0, z: -15 };
  advanceCivilianFlight(civilians, state, player, 'gate-defense', false, 100);
  assert.equal(state.encounterAt, null);
  assert.ok(civilians.every(person => !person.userData.fleeReleased));
  advanceCivilianFlight(civilians, state, player, 'withdrawal', false, 180);
  assert.equal(state.encounterAt, 180);
  assert.ok(civilians.slice(0, 3).every(person => person.userData.flightReleaseAt <= 181.5));
  advanceCivilianFlight(civilians, state, player, 'withdrawal', false, 183);
  assert.ok(civilians.slice(0, 3).every(person => person.userData.fleeReleased));
  assert.equal(civilians[4].userData.fleeReleased, false);
  assert.ok(civilians.every(person => !person.userData.arrived && !person.userData.evacuated));
  advanceCivilianFlight(civilians, state, { x: -66, y: 0, z: -80 }, 'dock-defense', true, 190);
  assert.ok(civilians.every(person => person.userData.fleeReleased || person.userData.flightReleaseAt <= 202));
  advanceCivilianFlight(civilians, state, null, 'dock-defense', true, 203);
  assert.ok(civilians.every(person => person.userData.fleeReleased));
  resetCivilianFlight(state); assert.equal(state.encounterAt, null);
});

test('all seated poses keep feet grounded on the unchanged thirteen-bone rig and stand without crossed walking legs', () => {
  const factory = createCivilianCharacterFactory(), camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  camera.position.set(0, 1, 3);
  for (let pose = 0; pose < 4; pose++) {
    const person = factory.create(pose + 30, 'adult', 'man', 'none');
    scene.add(person);
    Object.assign(person.userData, { ageGroup: 'adult', carrying: 'none', civilianId: pose,
      walkPhase: 0, restPose: pose, restPoseWeight: 1, refugeeRestPoint: { x: 0, z: 0 } });
    advanceCivilianMotion(person, { dt: .05, now: 1, moved: 0, mode: 'waiting' });
    updateCivilianAppearance([person], camera, 'high');
    person.updateMatrixWorld(true);
    assert.equal(person.civilianSkin.skeleton.bones.length, 13);
    for (const hand of Object.values(person.userData.seatedContacts.hands)) {
      assert.equal(hand.reachable, true);
      assert.ok(hand.error < .004, `real seated hand contact: ${hand.error}`);
    }
    for (const side of ['left', 'right']) {
      const foot = person.civilianSkin.joints[`${side}Foot`].getWorldPosition(new THREE.Vector3());
      assert.ok(foot.y > .05 && foot.y < .10, `pose ${pose}: ${foot.y}`);
    }
    assert.ok(civilianBodyHeight(person) < 1.2);
    assert.ok(civilianAimHeight(person) < .65);
    const ray = traceCivilianBullet([person], { x: 0, y: .6, z: 5 }, { x: 0, y: 0, z: -1 }, 10);
    assert.equal(ray.civilian, person, 'sitting must not make the civilian invulnerable');
    person.userData.restPoseWeight = 0;
    advanceCivilianMotion(person, { dt: .1, now: 2, moved: .15, dx: 0, dz: -.15 });
    updateCivilianAppearance([person], camera, 'low');
    assert.equal(person.civilianSkin.joints.leftLeg.rotation.z, 0);
    assert.equal(person.civilianSkin.joints.leftKnee.rotation.z, 0);
    assert.ok(Math.abs(person.civilianSkin.joints.root.position.y) < 1e-8);
  }
});

test('the three encounter cues are ordered, once per match, sourced from live matching civilians and absent from random chatter', () => {
  const director = createCivilianVoiceDirector(undefined, () => 0);
  const civilians = [
    ['adult', 'woman'], ['adult', 'man'], ['elderly', 'woman'],
  ].map(([ageGroup, presentation], civilianId) => ({ visible: true, position: { x: civilianId, y: 0, z: -18 },
    userData: { active: true, civilianId, ageGroup, presentation } }));
  const listener = { position: { x: 0, y: 1.5, z: -18 }, soldierId: 'player' };
  assert.equal(director.select(civilians, listener, 'withdrawal', 180).clip.encounterOrder, undefined);
  assert.equal(director.encounter(181), true);
  for (let index = 0; index < 3; index++) {
    const selected = director.select(civilians, listener, 'withdrawal', 182 + index);
    assert.equal(selected.clip.encounterOrder, index);
    assert.equal(selected.person.userData.dead, undefined);
  }
  assert.equal(director.encounter(200), false);
  director.reset(); assert.equal(director.encounter(201), true);
});
