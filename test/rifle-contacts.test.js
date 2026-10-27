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
  applyNativeFootCycle(root, bones, sampleNraMotion(actor), feet, () => 0);
  applyNativeBodyLean(root, bones, sampleNraMotion(actor));
  return { root, actor, bones, pose: createNraRiflePose(root, bones, rifleWorldModel()) };
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
