import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { soldierModel } from '../src/world.js';
import { createSoldierRenderer } from '../src/soldier-renderer.js';

test('corpse appearance derives from simulation death/seat/time without mutating health or physical position', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const renderer = createSoldierRenderer(scene, camera, 16);
  const actor = { id: 'enemy-1', friendly: false, health: 100, position: new THREE.Vector3(0, .3, -5),
    heading: .2, model: soldierModel(false), deathTime: 1, vehicleId: null };
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
  assert.equal(renderer.snapshot.visible, 0, 'the existing twelve-second corpse limit remains intact');
  assert.equal(actor.health, 0);
  assert.deepEqual(actor.position, position);
  for (const object of scene.children) if (object.isInstancedMesh) object.dispose();
});
