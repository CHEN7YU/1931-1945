import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNraRiflePose } from '../src/nra-rifle-pose.js';
import { createNativeGaitProfile, applyNativeFootCycle, applyNativeBodyLean } from '../src/nra-gait.js';
import { createNraMotion, sampleNraMotion } from '../src/nra-motion.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { rifleWorldModel } from '../src/rifle-model.js';

function fixture(ready) {
  const manager = new T.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
  const data = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  const inspected = prepareNraRig(model), root = new T.Group(), normalized = new T.Group();
  const bounds = new T.Box3().setFromObject(model);
  normalized.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); normalized.rotation.y = Math.PI;
  model.position.y -= bounds.min.y; normalized.add(model); root.add(normalized); root.updateMatrixWorld(true);
  const bones = inspected.canonical, postures = createNativePosturePoses(normalized, bones);
  const shoulder = bones.get('RightArm').getWorldPosition(new T.Vector3()).toArray();
  const clips = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url)));
  const profile = { ...createNativeGaitProfile(clips.motion.idle, shoulder),
    leanPivot: bones.get('Spine').getWorldPosition(new T.Vector3()).toArray(),
    rifleContacts: { standing: shoulder, ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.shoulder])) },
    riflePivots: { standing: bones.get('Spine').getWorldPosition(new T.Vector3()).toArray(),
      ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.pivot])) },
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.carry])) };
  const actor = { heading: 0, position: new T.Vector3(), walkPhase: 0, rifleReady: ready, locomotion: { speed: ready ? 0 : 3.15 } };
  actor.nativeMotion = createNraMotion(profile, actor);
  if (!ready) { actor.nativeMotion.speed = 3.15; actor.nativeMotion.weight = 1; }
  const feet = Object.fromEntries(['Left', 'Right'].map(side => [side, bones.get(`${side}Foot`).getWorldPosition(new T.Vector3())]));
  const rest = [...bones.values()].map(bone => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
  applyNativeFootCycle(root, bones, sampleNraMotion(actor), feet, () => 0);
  applyNativeBodyLean(root, bones, sampleNraMotion(actor));
  return { root, actor, bones, feet, rest, pose: createNraRiflePose(root, bones, rifleWorldModel()) };
}

test('real native hands contact the stock with neutral wrist alignment, deterministically on repeated sampling', () => {
  for (const ready of [true, false]) {
    const { actor, bones, pose } = fixture(ready), carry = sampleNraMotion(actor);
    const lengths = ['LeftForeArm', 'LeftHand', 'RightForeArm', 'RightHand'].map(name => bones.get(name).position.clone());
    pose.update(carry);
    const first = pose.snapshot;
    assert.equal(pose.issue, null);
    assert.ok(first.right.palmError < .005 && first.left.palmError < .005);
    assert.ok(new T.Vector3(...first.stock).distanceTo(new T.Vector3(...first.stockTarget)) < 1e-8);
    if (ready) assert.ok(new T.Vector3(...first.leftPalm).sub(new T.Vector3(...first.rightPalm))
      .dot(new T.Vector3(...first.direction)) > .24, 'support hand must advance onto the fore-end');
    assert.ok(Number.isFinite(first.fingerError) && first.fingerError < .03);
    pose.update(carry);
    const second = pose.snapshot;
    assert.equal(pose.issue, null);
    for (const key of ['stock', 'rightTarget', 'leftTarget', 'rightPalm', 'leftPalm']) {
      assert.ok(new T.Vector3(...first[key]).distanceTo(new T.Vector3(...second[key])) < 1e-7, key);
    }
    ['LeftForeArm', 'LeftHand', 'RightForeArm', 'RightHand'].forEach((name, i) => assert.deepEqual(bones.get(name).position, lengths[i]));
  }
});

test('sprint elbow follow changes only the bend plane while keeping real rifle contacts stable', () => {
  const { root, actor, bones, feet, rest, pose } = fixture(false);
  actor.health = 100;
  Object.assign(actor.nativeMotion, { speed: 4.1, weight: 1, gaitAim: 0, gaitCharge: .59326171875,
    lowReady: 1, travelCarryBlend: 1, bodyLean: .7330382858 });
  const lengths = ['LeftForeArm', 'LeftHand', 'RightForeArm', 'RightHand'].map(name => bones.get(name).position.clone());
  const offsets = { left: [], right: [] };
  let previous = null;
  for (let i = 0; i <= 32; i++) {
    actor.nativeMotion.gaitCycles = i / 32;
    const carry = sampleNraMotion(actor, false);
    for (const item of rest) { item.bone.position.copy(item.position); item.bone.quaternion.copy(item.rotation); }
    root.updateMatrixWorld(true);
    applyNativeFootCycle(root, bones, carry, feet, () => 0);
    applyNativeBodyLean(root, bones, carry);
    pose.update({ ...carry, gaitCharge: 0 });
    const baseline = pose.snapshot;
    pose.update(carry, false);
    const collision = pose.snapshot;
    for (const side of ['left', 'right'])
      assert.ok(new T.Vector3(...collision[`${side}Elbow`]).distanceTo(
        new T.Vector3(...baseline[`${side}Elbow`])) < 1e-7, `${side} collision bend must remain unchanged`);
    pose.update(carry);
    const candidate = pose.snapshot;
    assert.equal(pose.issue, null);
    for (const key of ['muzzle', 'stock', 'rightPalmTarget', 'leftPalmTarget']) {
      assert.ok(new T.Vector3(...baseline[key]).distanceTo(new T.Vector3(...candidate[key])) < 1e-8, key);
    }
    for (const side of ['left', 'right']) {
      assert.ok(candidate[side].reachable && candidate[side].error < 1e-5);
      assert.ok(candidate[side].palmError < .005);
      const elbow = new T.Vector3(...candidate[`${side}Elbow`]);
      const correction = elbow.sub(new T.Vector3(...baseline[`${side}Elbow`]));
      offsets[side].push(correction.length());
      if (previous) assert.ok(correction.distanceTo(previous[side]) < .005,
        `${side} elbow correction jumps at ${i}/32`);
    }
    previous = Object.fromEntries(['left', 'right'].map(side =>
      [side, new T.Vector3(...candidate[`${side}Elbow`]).sub(new T.Vector3(...baseline[`${side}Elbow`]))]));
    for (const patch of [{ intent: 'aim' }, { gaitCharge: .25 }, { weight: 0 }, { lowReady: 0 }, { gaitAim: 1 }, { upright: 0 },
      { rifleOperation: { hand: 0 } }]) {
      pose.update({ ...carry, ...patch });
      const excluded = pose.snapshot;
      pose.update({ ...carry, ...patch, gaitCharge: 0 });
      const reference = pose.snapshot;
      for (const side of ['left', 'right'])
        assert.ok(new T.Vector3(...excluded[`${side}Elbow`]).distanceTo(
          new T.Vector3(...reference[`${side}Elbow`])) < 1e-7, `${side} ${JSON.stringify(patch)}`);
    }
  }
  for (const side of ['left', 'right']) {
    assert.ok(Math.max(...offsets[side]) > .001, `${side} bend plane must move`);
    assert.ok(Math.max(...offsets[side]) < .03, `${side} bend plane must remain restrained`);
  }
  ['LeftForeArm', 'LeftHand', 'RightForeArm', 'RightHand'].forEach((name, i) => assert.deepEqual(bones.get(name).position, lengths[i]));
});
