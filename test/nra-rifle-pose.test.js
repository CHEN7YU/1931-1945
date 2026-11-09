import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveArm, PoseGeometryError } from '../src/nra-rifle-pose.js';
import { recoverCharacterPose } from '../src/character-pose-recovery.js';

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

test('parallel and zero elbow hints keep a valid bend plane instead of interrupting the battle', () => {
  for (const axis of [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    for (const zero of [false, true]) {
      const { root, upper, lower, hand } = arm();
      const target = root.localToWorld(axis.clone().multiplyScalar(.3));
      const pole = zero ? new THREE.Vector3() : target.clone().sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
      const result = solveArm(upper, lower, hand, target, pole);
      assert.equal(result.reachable, true); assert.ok(result.error < 1e-7);
      for (const bone of [upper, lower, hand]) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
      assert.ok(Math.abs(upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3())) - .24) < 1e-7);
      assert.ok(Math.abs(lower.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3())) - .26) < 1e-7);
    }
  }
});

test('invalid presentation geometry restores the previous pose, records recovery and allows the next update', () => {
  const { root, upper, lower, hand } = arm(), reports = [];
  const actor = { id: 'enemy-fixture', position: new THREE.Vector3(4, 2, -8), heading: .5, team: 'enemy', health: 100 };
  const initial = lower.position.clone(), recover = recoverCharacterPose(root, (error, context) => reports.push({ error, context }));
  const update = recover(() => {
    lower.position.set(0, 0, 0); root.updateMatrixWorld(true);
    solveArm(upper, lower, hand, actor.position.clone().add(new THREE.Vector3(0, 0, -.2)), new THREE.Vector3(0, 1, 0));
  });
  update(actor, 1, 'player');
  assert.deepEqual(lower.position, initial); assert.deepEqual(root.position, actor.position);
  assert.equal(root.visible, true); assert.equal(actor.health, 100);
  assert.equal(reports.length, 1); assert.ok(reports[0].error instanceof PoseGeometryError);
  assert.equal(reports[0].context.stage, 'character-pose');
  recover(() => { upper.rotation.x = .2; })(actor, 2, 'player');
  assert.equal(upper.rotation.x, .2);
  assert.throws(() => recover(() => { throw new Error('not a presentation geometry failure'); })(actor), /not a presentation/);
  actor.position.x = NaN;
  assert.throws(() => recover(() => { throw new PoseGeometryError('invalid simulation position'); })(actor), /invalid simulation position/);
  assert.equal(reports.length, 1, 'invalid actor state must not be disguised as a recovered visual pose');
});
