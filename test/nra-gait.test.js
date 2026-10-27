import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Bone, Vector3 } from 'three';
import { applyNativeLegLift, applyNativeBodyLean } from '../src/nra-gait.js';

function legs() {
  const root = new Group(), bones = new Map();
  for (const side of ['Left', 'Right']) {
    const upper = new Bone(), knee = new Bone(), foot = new Bone();
    upper.position.set(side === 'Left' ? -.1 : .1, 1, 0);
    knee.position.set(0, -.4, -.2); foot.position.set(0, -.35, .2);
    root.add(upper); upper.add(knee); knee.add(foot);
    for (const [name, bone] of [['UpLeg', upper], ['Leg', knee], ['Foot', foot]]) bones.set(`${side}${name}`, bone);
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

test('individual lift changes real ankle trajectories without stretching legs or changing simulation state', () => {
  const results = [];
  for (const legLift of [.55, .85]) {
    const { root, bones } = legs(), motion = { legLift, weight: 1, jog: 1, upright: 1 };
    const before = structuredClone(motion), result = applyNativeLegLift(root, bones, motion, 0);
    assert.deepEqual(motion, before);
    assert.ok(result.left.error < 1e-5 && result.right.error < 1e-5);
    assert.ok(result.left.targetY < result.left.sourceY);
    assert.equal(bones.get('LeftLeg').position.y, -.4);
    assert.equal(bones.get('LeftFoot').position.y, -.35);
    results.push(result.left.targetY);
  }
  assert.ok(results[1] - results[0] > .04);
});

test('leg-lift adjustment is not applied to kneeling, prone or walking', () => {
  for (const changes of [{ upright: 0 }, { jog: 0 }, { weight: 0 }]) {
    const { root, bones } = legs();
    assert.deepEqual(applyNativeLegLift(root, bones, { legLift: .55, weight: 1, jog: 1, upright: 1, ...changes }, 0), { factor: 1 });
  }
});

test('torso lean follows the actor-facing direction and counter-rotates the head without moving the hips', () => {
  const root = new Group(), spine = new Bone(), head = new Bone();
  spine.position.y = 1; head.position.y = .5; root.add(spine); spine.add(head); root.rotation.y = 1.3;
  root.updateMatrixWorld(true);
  const before = spine.getWorldPosition(new Vector3());
  applyNativeBodyLean(root, new Map([['Spine', spine], ['Head', head]]), { bodyLean: .2 });
  const point = head.getWorldPosition(new Vector3());
  assert.ok(point.x < -.09 && point.z < 0 && point.y < 1.5);
  assert.ok(spine.getWorldPosition(new Vector3()).distanceTo(before) < 1e-10);
});
