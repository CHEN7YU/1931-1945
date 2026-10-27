import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveArm } from '../src/nra-rifle-pose.js';

function arm() {
  const root = new THREE.Group(), upper = new THREE.Bone(), lower = new THREE.Bone(), hand = new THREE.Bone();
  root.add(upper); upper.add(lower); lower.add(hand);
  lower.position.set(0, -.24, 0); hand.position.set(0, -.26, 0);
  root.position.set(3, 1, -5); root.rotation.y = .7;
  root.updateMatrixWorld(true);
  return { root, upper, lower, hand };
}

test('two-bone rifle pose reaches a real target without stretching either arm segment', () => {
  const { root, upper, lower, hand } = arm();
  const target = root.localToWorld(new THREE.Vector3(.08, -.12, -.29));
  const pole = new THREE.Vector3(1, -1, .1).transformDirection(root.matrixWorld);
  const result = solveArm(upper, lower, hand, target, pole);
  assert.equal(result.reachable, true);
  assert.ok(result.error < 1e-7);
  assert.ok(Math.abs(upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3())) - .24) < 1e-7);
  assert.ok(Math.abs(lower.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3())) - .26) < 1e-7);
});

test('unreachable rifle targets report residual error rather than stretching or pretending success', () => {
  const { root, upper, lower, hand } = arm();
  const result = solveArm(upper, lower, hand, root.localToWorld(new THREE.Vector3(0, 0, -2)), new THREE.Vector3(0, -1, 0));
  assert.equal(result.reachable, false);
  assert.ok(result.error > 1.49);
});

test('singular elbow hints surface an explicit error', () => {
  const { root, upper, lower, hand } = arm();
  const target = root.localToWorld(new THREE.Vector3(0, -.3, 0));
  assert.throws(() => solveArm(upper, lower, hand, target, new THREE.Vector3(0, -1, 0)), /hint is parallel/);
});
