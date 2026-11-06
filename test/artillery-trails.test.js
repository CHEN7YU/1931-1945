import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEmplacement, emplacementPose } from '../src/emplacements.js';
import { createEmplacementModel } from '../src/emplacement-model.js';

test('both artillery trails have continuous real geometry from the axle pivot down to their ground feet', () => {
  const point = createEmplacement({ id: 'gun', profile: 'bofors75', x: 0, z: 0, heading: 0 });
  const model = createEmplacementModel(point);
  assert.equal(model.userData.artilleryTrails.length, 2);
  model.updateMatrixWorld(true);
  for (const trail of model.userData.artilleryTrails) {
    const start = new THREE.Vector3(...trail.pivot), end = new THREE.Vector3(...trail.end);
    for (let step = 0; step <= 20; step++) {
      const sample = start.clone().lerp(end, step / 20);
      const ray = new THREE.Raycaster(sample.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0), 0, 1.3);
      const hit = ray.intersectObject(model, true)[0];
      assert.ok(hit, `${trail.side} has an air gap at ${step}/20`);
      assert.ok(Math.abs(hit.point.y - sample.y) < .22, 'the hit must be the connected trail or its axle collar');
    }
  }
  assert.equal(emplacementPose(point).firingPose, 'kneeling');
  assert.equal(emplacementPose(point).stance, 'crouched');
  point.position = 'march'; model.userData.update();
  assert.equal(emplacementPose(point).stance, 'standing');
  assert.equal(model.userData.supportWeapon.stance, 'standing');
  point.position = 'gunner'; model.userData.update();
  assert.equal(model.userData.supportWeapon.firingPose, 'kneeling');
});
