import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Bone, Vector3 } from 'three';
import { lowStepTarget, runningStepTarget, applyNativeFootCycle, applyNativeBodyLean } from '../src/nra-gait.js';

function legs() {
  const root = new Group(), bones = new Map(), hips = new Bone();
  root.add(hips); bones.set('Hips', hips);
  for (const side of ['Left', 'Right']) {
    const upper = new Bone(), knee = new Bone(), foot = new Bone();
    upper.position.set(side === 'Left' ? -.1 : .1, 1, 0);
    knee.position.set(0, -.4, -.2); foot.position.set(0, -.35, .2);
    hips.add(upper); upper.add(knee); knee.add(foot);
    for (const [name, bone] of [['UpLeg', upper], ['Leg', knee], ['Foot', foot]]) bones.set(`${side}${name}`, bone);
  }
  root.updateMatrixWorld(true);
  const restFeet = Object.fromEntries(['Left', 'Right'].map(side => [side, bones.get(`${side}Foot`).getWorldPosition(new Vector3())]));
  return { root, bones, restFeet };
}

test('low steps use bounded foot trajectories without stretching legs or changing simulation state', () => {
  const results = [];
  for (const legLift of [.55, .85]) {
    const { root, bones, restFeet } = legs(), motion = { legLift, weight: 1, jog: 1, upright: 1,
      hipDrop: .09, walkPhase: .6, runPhase: .6, walkStride: 1.25, runStride: 2.4 };
    const before = structuredClone(motion), result = applyNativeFootCycle(root, bones, motion, restFeet, () => 0);
    assert.deepEqual(motion, before);
    assert.ok(result.left.error < 1e-5 && result.right.error < 1e-5);
    assert.ok(result.left.requestedLift > .1 && result.left.requestedLift < .3);
    assert.equal(bones.get('LeftLeg').position.y, -.4);
    assert.equal(bones.get('LeftFoot').position.y, -.35);
    results.push(result.left.requestedLift);
  }
  assert.ok(results[1] - results[0] > .003);
});

test('low-step gait leaves stationary and static combat postures unchanged', () => {
  for (const changes of [{ upright: 0 }, { weight: 0 }]) {
    const { root, bones, restFeet } = legs();
    assert.deepEqual(applyNativeFootCycle(root, bones, { legLift: .55, weight: 1, jog: 1, upright: 1, ...changes },
      restFeet, () => 0), { kind: 'native-foot-cycle', weight: 0 });
  }
});

test('running has rear-heel recovery distinct from low walking without high forward foot lifts', () => {
  const samples = Array.from({ length: 100 }, (_, index) => runningStepTarget(index / 100, 2.4, .24));
  assert.ok(samples.some(point => point.stage === 'rear-recovery' && point.z > .1 && point.lift > .18));
  assert.ok(samples.filter(point => point.z < -.2).every(point => point.lift < .08));
  assert.ok(samples.every(point => point.lift >= 0 && point.lift <= .24));
  assert.ok(Math.abs((runningStepTarget(.1, 2.4, .24).z - runningStepTarget(.05, 2.4, .24).z) - .12) < 1e-10);
  assert.ok(lowStepTarget(.6, 1.25, .52, .04).lift < .05);
});

test('ground-contact travel matches actual stride while swing clearance stays below eight centimetres', () => {
  for (const [stride, duty] of [[1.25, .52], [2.4, .27]]) {
    for (let frame = 0; frame < 100; frame++) {
      const phase = frame / 100, point = lowStepTarget(phase, stride, duty, .07);
      assert.ok(point.lift >= 0 && point.lift <= .07);
      if (phase < duty) assert.equal(point.lift, 0);
    }
    const a = lowStepTarget(.05, stride, duty, .07), b = lowStepTarget(.1, stride, duty, .07);
    assert.ok(Math.abs((b.z - a.z) - stride * .05) < 1e-10);
    assert.ok(Math.abs(lowStepTarget(.999999, stride, duty, .07).z - lowStepTarget(0, stride, duty, .07).z) < 1e-5);
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
