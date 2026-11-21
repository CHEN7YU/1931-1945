import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCivilianCharacterFactory } from '../src/civilian-character.js';
import { createNanjingFerryFactory, updateNanjingFerryRower, createShoreReeds, NANJING_FERRY_FLOOR } from '../src/nanjing-river-details.js';

test('five open wooden ferries share finite low-cost hull geometry and have separate oars', () => {
  const make = createNanjingFerryFactory(new THREE.MeshStandardMaterial());
  const boats = Array.from({ length: 5 }, make);
  const geometry = boats[0].children[0].geometry;
  assert.ok(geometry.attributes.position.array.every(Number.isFinite));
  assert.ok(geometry.index.count / 3 < 3000);
  for (const boat of boats) {
    assert.equal(boat.children[0].geometry, geometry);
    assert.equal(boat.children[0].userData.nanjingFeature, 'open-planked-ferry');
    assert.notEqual(boat.userData.oar, boats[(boats.indexOf(boat) + 1) % 5].userData.oar);
  }
  assert.ok(NANJING_FERRY_FLOOR < .6, 'passengers stand inside the open hull rather than on a lid');
});

test('a dedicated boatman rows on empty inbound and outbound trips and rests when docked', () => {
  const ferry = createNanjingFerryFactory(new THREE.MeshStandardMaterial())();
  const rower = new THREE.Group();
  rower.civilianTorso = new THREE.Group();
  rower.civilianArms = [new THREE.Group(), new THREE.Group()];
  rower.civilianSkin = { joints: { leftElbow: new THREE.Group(), rightElbow: new THREE.Group() } };
  rower.add(rower.civilianSkin.joints.leftElbow, rower.civilianSkin.joints.rightElbow);
  rower.civilianSkin.joints.leftElbow.position.x = -.2;
  rower.civilianSkin.joints.rightElbow.position.x = .2;
  ferry.add(rower);
  Object.assign(ferry.userData, { rower, passengers: [] });
  for (const state of ['outbound', 'inbound']) {
    ferry.userData.state = state;
    updateNanjingFerryRower(ferry, 1);
    const before = rower.civilianArms[0].rotation.x;
    updateNanjingFerryRower(ferry, 1.2);
    assert.ok(ferry.userData.oar.visible);
    assert.notEqual(rower.civilianArms[0].rotation.x, before);
    assert.equal(ferry.userData.passengers.length, 0);
  }
  ferry.userData.state = 'docked';
  updateNanjingFerryRower(ferry, 2);
  assert.equal(ferry.userData.oar.visible, false);
  assert.equal(rower.civilianTorso.rotation.x, 0);
});

test('the boatman holds the paddle in front of his chest while rowing', () => {
  const ferry = createNanjingFerryFactory(new THREE.MeshStandardMaterial())();
  const rower = createCivilianCharacterFactory().create(1000, 'adult', 'man', 'none');
  rower.position.set(2.35, NANJING_FERRY_FLOOR, .1);
  ferry.add(rower);
  ferry.userData.rower = rower;
  ferry.userData.state = 'outbound';
  updateNanjingFerryRower(ferry, 1);
  ferry.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rower.getWorldQuaternion(new THREE.Quaternion()));
  const chest = new THREE.Vector3(0, 1.1, 0).applyMatrix4(rower.matrixWorld);
  const grip = ferry.localToWorld(ferry.userData.oar.position.clone());
  assert.ok(grip.sub(chest).dot(forward) > .2, 'the paddle grip must remain in front of the torso');
});

test('shore reeds are one opaque merged mesh, retain dock clearance, and do not register collision', () => {
  const banks = [-100, -80, -60].map(z => {
    const bank = new THREE.Mesh(); bank.position.set(-73.5, -1.5, z);
    bank.scale.set(3, 3.1, 3);
    bank.userData = { riverId: 'yangtze-west', shoreline: {
      from: z - 1.5, to: z + 1.5, startInset: 1, endInset: 1,
    } };
    return bank;
  });
  const reeds = createShoreReeds(banks), positions = reeds.geometry.attributes.position;
  assert.ok(positions.count > 0);
  assert.ok(positions.array.every(Number.isFinite));
  assert.equal(reeds.material.transparent, false);
  assert.equal(reeds.castShadow, false);
  for (let i = 0; i < positions.count; i++)
    assert.ok(positions.getZ(i) < -94 || positions.getZ(i) > -66);
});
