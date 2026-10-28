import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { soldierModel } from '../src/world.js';
import { createSoldierRenderer, syncSoldierModelPose } from '../src/soldier-renderer.js';

test('corpse appearance derives from simulation death/seat/time without mutating health or physical position', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const renderer = createSoldierRenderer(scene, camera, 16);
  const actor = { id: 'enemy-1', friendly: false, health: 100, position: new THREE.Vector3(0, .3, -5),
    heading: .2, model: soldierModel(false), deathTime: 1, vehicleId: null, walkPhase: 0, walkPoseReady: false };
  renderer.update([actor], 'high', 1);
  assert.equal(renderer.snapshot.visible, 1);
  assert.equal(actor.model.rotation.z, 0);
  actor.health = 0; actor.model.visible = false;
  const position = actor.position.clone();
  renderer.update([actor], 'high', 1.1);
  assert.equal(renderer.snapshot.visible, 1, 'a ground corpse is not hidden by a stale first-person visibility flag');
  assert.equal(actor.model.rotation.z, Math.PI / 2);
  assert.equal(actor.health, 0);
  assert.deepEqual(actor.position, position);
  actor.vehicleId = 'tank-1';
  renderer.update([actor], 'high', 1.2);
  assert.equal(renderer.snapshot.visible, 0);
  actor.vehicleId = null;
  renderer.update([actor], 'high', 13.1);
  assert.equal(renderer.snapshot.visible, 1, 'corpse removal belongs to the shared retention policy, not a twelve-second renderer timer');
  assert.equal(actor.health, 0);
  assert.deepEqual(actor.position, position);
  for (const object of scene.children) if (object.isInstancedMesh) object.dispose();
});
test('idle models retain neutral legs and near/far batches project the same simulation gait without advancing it', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const renderer = createSoldierRenderer(scene, camera, 16);
  const actor = { id: 'enemy-2', friendly: false, health: 100, position: new THREE.Vector3(0, 0, -5),
    heading: .4, model: soldierModel(false), deathTime: 0, vehicleId: null, walkPhase: 1.2, walkPoseReady: false };
  const [left, right] = actor.model.userData.legs;
  renderer.update([actor], 'high', 1);
  assert.equal(left.rotation.x, 0); assert.equal(right.rotation.x, 0);
  actor.walkPoseReady = true;
  const phase = actor.walkPhase;
  for (const distance of [5, 70]) {
    actor.position.z = -distance;
    const position = actor.position.clone();
    renderer.update([actor], 'high', 2);
    assert.ok(Math.abs(left.rotation.x - Math.sin(phase) * .35) < 1e-10);
    assert.equal(right.rotation.x, -left.rotation.x);
    assert.equal(actor.walkPhase, phase);
    assert.equal(actor.health, 100);
    assert.deepEqual(actor.position, position);
    assert.equal(renderer.snapshot[distance === 5 ? 'near' : 'far'], 1);
    const batch = scene.children.find(object => object.isInstancedMesh && object.count > 0);
    const actual = new THREE.Matrix4(); batch.getMatrixAt(0, actual);
    const expected = new THREE.Matrix4().multiplyMatrices(actor.model.matrix, left.matrix);
    assert.ok(actual.elements.every((value, index) => Math.abs(value - expected.elements[index]) < 1e-5));
  }
  actor.health = 0; actor.deathTime = 2;
  renderer.update([actor], 'high', 3);
  assert.equal(left.rotation.x, Math.sin(phase) * .35, 'death retains the previous procedural leg pose');
  assert.equal(actor.walkPhase, phase);
  for (const object of scene.children) if (object.isInstancedMesh) object.dispose();
});
test('physical hit geometry can be synchronised from owned pose before any rendered frame', () => {
  const actor = { health: 100, position: new THREE.Vector3(0, .45, -5), heading: 1.2,
    walkPhase: .8, walkPoseReady: true, model: soldierModel(false) };
  actor.model.position.set(100, 100, 100);
  actor.model.rotation.y = -2;
  actor.model.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, -5), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(actor.model, true).length, 0);
  const before = { position: actor.position.clone(), heading: actor.heading, phase: actor.walkPhase, health: actor.health };
  const model = syncSoldierModelPose(actor);
  model.updateMatrixWorld(true);
  const hit = ray.intersectObject(model, true)[0];
  assert.ok(hit);
  assert.ok(hit.point.y > 1.9 && hit.point.y < 2.7);
  assert.deepEqual(actor.position, before.position);
  assert.equal(actor.heading, before.heading);
  assert.equal(actor.walkPhase, before.phase);
  assert.equal(actor.health, before.health);
  assert.throws(() => syncSoldierModelPose({ ...actor, walkPhase: NaN }), /owned position/);
});
test('seated and controlled-body visibility derives from ownership rather than stale model flags', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const renderer = createSoldierRenderer(scene, camera, 16);
  const actor = { id: 'crew-1', health: 100, friendly: false, position: new THREE.Vector3(0, 0, -5), heading: 0,
    walkPhase: 0, walkPoseReady: false, deathTime: 0, model: soldierModel(false), vehicleId: 'tank-1' };
  actor.model.visible = true;
  renderer.update([actor], 'high', 1, null);
  assert.equal(renderer.snapshot.visible, 0);
  actor.vehicleId = null;
  renderer.update([actor], 'high', 1, actor.id);
  assert.equal(renderer.snapshot.visible, 0);
  actor.model.visible = false;
  renderer.update([actor], 'high', 1, 'other-member');
  assert.equal(renderer.snapshot.visible, 1);
  assert.equal(actor.health, 100);
  for (const object of scene.children) if (object.isInstancedMesh) object.dispose();
});
test('a separate skinned view excludes only its procedural batch while retaining the owned physical hit proxy', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  const renderer = createSoldierRenderer(scene, camera, 16);
  const actor = { id: 'native-view', health: 100, friendly: false, position: new THREE.Vector3(0, 0, -5), heading: .4,
    walkPhase: .3, walkPoseReady: true, deathTime: 0, model: soldierModel(false), vehicleId: null };
  renderer.update([actor], 'high', 1, null, actor.id);
  assert.equal(renderer.snapshot.visible, 0);
  assert.equal(actor.model.visible, true, 'exclusion must not remove the physical proxy');
  assert.deepEqual(actor.model.position, actor.position);
  assert.equal(actor.model.rotation.y, actor.heading);
  assert.equal(actor.health, 100);
  renderer.update([actor], 'high', 1, null);
  assert.equal(renderer.snapshot.visible, 1, 'the baseline procedural route remains available');
  for (const object of scene.children) if (object.isInstancedMesh) object.dispose();
});
