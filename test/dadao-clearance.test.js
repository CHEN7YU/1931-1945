import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { swordRig, swordBodyVolumes, segmentClearance } from '../scripts/lib/dadao-rig.mjs';

const rig = await swordRig();

test('both complete sword cycles keep thick upper arms, forearms and hands outside the head neck and upper chest', () => {
  let minimum = Infinity;
  for (const idleTime of [0, 2.1, 5.9]) for (const style of [0, 1])
  for (const phase of ['draw', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 200; frame++) {
    rig.sample({ style, phase, progress: frame / 200 }, idleTime);
    const label = `${idleTime}/${style}/${phase}/${frame}`;
    assert.equal(rig.sword.issue, null, label);
    for (const side of ['Left', 'Right']) for (const [a, b] of [
      ['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['Hand', 'HandMiddle1'],
    ]) for (const volume of swordBodyVolumes(rig.point)) {
      const clearance = segmentClearance(rig.point(side + a), rig.point(side + b), volume);
      minimum = Math.min(minimum, clearance);
      assert.ok(clearance > .003, `${label}/${side}/${a}/${volume.name}: penetration or insufficient margin ${clearance}`);
    }
    const { wristAlignment, leftWristAlignment, leftPalmError, error } = rig.sword.snapshot;
    assert.ok(wristAlignment > .65 && leftWristAlignment > .65, `${label}: wrist folds`);
    assert.ok(leftPalmError < 1e-6 && error < 1e-6, `${label}: grip detaches`);
  }
  assert.ok(minimum > .003);
});

test('actual full-body cuts lead with the sharpened edge, never the broad face, throughout both styles', () => {
  for (const idleTime of [0, 2.1, 5.9]) for (const style of [0, 1]) for (let frame = 2; frame <= 198; frame++) {
    const pose = { style, phase: 'cut', progress: frame / 200 };
    rig.sample({ ...pose, progress: pose.progress - .0001 }, idleTime);
    const before = [.3, .45, .6].map(y => rig.sword.blade.localToWorld(new T.Vector3(.04, y, 0)));
    rig.sample(pose, idleTime);
    const rotation = rig.sword.blade.getWorldQuaternion(new T.Quaternion());
    const edge = new T.Vector3(1, 0, 0).applyQuaternion(rotation);
    const axis = new T.Vector3(0, 1, 0).applyQuaternion(rotation);
    const face = new T.Vector3(0, 0, 1).applyQuaternion(rotation);
    for (const [section, y] of [.3, .45, .6].entries()) {
      const velocity = rig.sword.blade.localToWorld(new T.Vector3(.04, y, 0)).sub(before[section]).normalize();
      const cutting = velocity.clone().addScaledVector(axis, -velocity.dot(axis)).normalize();
      const label = `${idleTime}/${style}/${frame}/${y}`;
      assert.ok(cutting.dot(edge) > .99, `${label}: blade roll disagrees with the cutting tangent ${cutting.dot(edge)}`);
      assert.ok(Math.abs(velocity.dot(face)) < .06, `${label}: face-first slap ${velocity.dot(face)}`);
      assert.ok(velocity.dot(edge) > .6, `${label}: edge reverses during the stroke`);
    }
  }
});
