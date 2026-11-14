import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFloatingBodies } from '../src/floating-bodies.js';
import { waterWaveHeight } from '../src/water-waves.js';

test('decorative remains follow the same wave without joining the simulated forces', () => {
  const scene = new THREE.Scene();
  const factory = { create() {
    const body = new THREE.Group();
    body.civilianSkin = { joints: Object.fromEntries(
      ['leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'leftLeg', 'rightLeg'].map(name => [name, new THREE.Object3D()])) };
    return body;
  } };
  const placements = [{ x: 10, z: 15, waterLevel: -1, heading: .5 }];
  const floating = createFloatingBodies(scene, factory, placements);
  floating.update(5);
  const [body] = floating.bodies;
  assert.equal(body.parent, scene);
  assert.equal(body.userData.scenery, true);
  assert.equal(body.position.y, -1 + waterWaveHeight(10, 15, 5) + .04);
  const dx = waterWaveHeight(10.5, 15, 5) - waterWaveHeight(9.5, 15, 5);
  const dz = waterWaveHeight(10, 15.5, 5) - waterWaveHeight(10, 14.5, 5);
  const expectedNormal = new THREE.Vector3(-dx, 1, -dz).normalize();
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion).distanceTo(expectedNormal) < 1e-10);
  const height = body.position.y;
  floating.update(8);
  assert.notEqual(body.position.y, height);
  assert.equal(body.position.x, 10);
  assert.equal(body.position.z, 15);
});
