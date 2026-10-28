import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { createNativeGaitProfile, applyNativeUpperBody } from '../src/nra-gait.js';
import { createHeadAimProfile, createHeadAimProbe } from '../src/head-aim.js';
import { createNraMotion, sampleNraMotion, nativeAimReady, advanceNraMotion, syncNativeAimGoal } from '../src/nra-motion.js';
import { shoulderPocket } from '../src/rifle-contacts.js';
import { soldierEyePosition, soldierPostureHeight } from '../src/entities.js';
import { FIRING_POSES } from '../src/combat-posture.js';

function fixture() {
  const manager = new T.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
  const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const rig = prepareNraRig(model), root = new T.Group(), normalized = new T.Group();
  const bounds = new T.Box3().setFromObject(model);
  normalized.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); normalized.rotation.y = Math.PI;
  model.position.y -= bounds.min.y; normalized.add(model); root.add(normalized); root.updateMatrixWorld(true);
  const bones = rig.canonical, p = name => bones.get(name).getWorldPosition(new T.Vector3()).toArray();
  const postures = createNativePosturePoses(normalized, bones);
  const data = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url)));
  const idle = T.AnimationClip.parse(data.idle);
  const pocket = shoulderPocket(p('RightShoulder'), p('RightArm'), {
    leftClavicle: p('LeftShoulder'), neck: p('Neck'), chest: p('Spine2') });
  const profile = { ...createNativeGaitProfile(data.motion.idle, p('RightArm'), pocket), leanPivot: p('Spine'),
    rifleContacts: { standing: p('RightArm'), ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.shoulder])) },
    rifleShoulderContacts: { standing: pocket, ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.pocket])) },
    riflePivots: { standing: p('Spine'), ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.pivot])) },
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.carry])) };
  profile.headAim = createHeadAimProfile(normalized, bones, idle, postures, rig.meshes);
  const probe = createHeadAimProbe(root, bones, rig.meshes);
  const mixer = new T.AnimationMixer(rig.meshes[0]);
  const actions = { standing: mixer.clipAction(idle),
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, mixer.clipAction(value.clip)])) };
  for (const action of Object.values(actions)) { action.play(); action.paused = true; }
  const rest = [...bones.values()].map(bone => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
  const actor = { position: new T.Vector3(3, .2, -4), heading: .7, walkPhase: 1.2, stance: 'standing',
    rifleReady: true, locomotion: { speed: 0, mode: 'idle' } };
  actor.nativeMotion = createNraMotion(profile, actor);
  return { actor, profile, bones, normalized, postures, idle, meshes: rig.meshes,
    project(stance, ready, idleTime = .8, lean = .03, partial = 1) {
      for (const item of rest) { item.bone.position.copy(item.position); item.bone.quaternion.copy(item.rotation); }
      actor.stance = FIRING_POSES[stance]?.stance ?? 'standing'; actor.firingPose = stance === 'standing' ? null : stance;
      actor.rifleReady = ready;
      Object.assign(actor.nativeMotion, { lowReady: ready ? 0 : 1, cheekWeight: ready ? 1 : 0, idleTime, bodyLean: lean, weight: 0, speed: 0 });
      for (const name of Object.keys(FIRING_POSES)) actor.nativeMotion.posture[name] = name === stance ? partial : 0;
      syncNativeAimGoal(actor);
      const pose = sampleNraMotion(actor);
      for (const [name, action] of Object.entries(actions)) {
        action.time = name === 'standing' ? pose.idleTime : 0;
        action.setEffectiveWeight(name === 'standing' ? pose.upright : pose.postures[name]);
      }
      mixer.update(0);
      for (const item of rest) { item.position.copy(item.bone.position); item.rotation.copy(item.bone.quaternion); }
      root.position.copy(actor.position); root.rotation.y = actor.heading; root.updateMatrixWorld(true);
      const length = bones.get('Neck').getWorldPosition(new T.Vector3()).distanceTo(bones.get('Head').getWorldPosition(new T.Vector3()));
      const headLocal = bones.get('Head').position.clone(), neckLocal = bones.get('Neck').position.clone();
      applyNativeUpperBody(root, bones, pose);
      const actual = probe(pose.headAim, pose);
      assert.deepEqual(bones.get('Head').position, headLocal);
      assert.deepEqual(bones.get('Neck').position, neckLocal);
      assert.ok(Math.abs(length - bones.get('Neck').getWorldPosition(new T.Vector3()).distanceTo(
        bones.get('Head').getWorldPosition(new T.Vector3()))) < 1e-6);
      return { pose, actual };
    } };
}

test('real weighted eye geometry, camera/sensing projection and head bones share one pose without stretching', () => {
  const f = fixture();
  assert.ok(f.profile.headAim.samples.eye.some(influence => influence.bone === 'Neck'));
  for (const stance of ['standing', ...Object.keys(FIRING_POSES)]) {
    for (const time of [0, 2.1, 5.9]) for (const lean of [0, .05, .1]) {
      const { pose, actual } = f.project(stance, true, time, lean);
      assert.ok(actual.projectionError < 1e-6, `${stance}: ${actual.projectionError}`);
      assert.ok(pose.headAim.sightError < .004, `${stance}: ${pose.headAim.sightError}`);
      assert.ok(pose.headAim.cheekError < .012 && pose.headAim.gazeError < .05);
      assert.ok(actual.actualSightError < .004 && actual.actualCheekError < .012);
      const eye = soldierEyePosition(f.actor);
      assert.ok(new T.Vector3(eye.x, eye.y, eye.z).distanceTo(new T.Vector3(...actual.actualEye)) < 1e-6);
      assert.equal(soldierPostureHeight(f.actor), pose.headAim.eye[1]);
      assert.equal(nativeAimReady(f.actor), true);
    }
  }
});

test('travel and partial posture blends keep the same eye projection, with no aim pose during prone carry', () => {
  const f = fixture();
  for (const stance of ['standing', ...Object.keys(FIRING_POSES)]) {
    const carry = f.project(stance, false);
    assert.equal(carry.pose.headAim.weight, 0);
    assert.ok(carry.actual.projectionError < 1e-6);
    assert.equal(nativeAimReady(f.actor), false);
    const partial = f.project(stance, true, 1.4, .04, .5);
    assert.ok(partial.actual.projectionError < 1e-6);
  }
});

test('pause and repeated sampling do not advance or mutate the simulation; missing eye calibration fails explicitly', () => {
  const f = fixture();
  f.project('standing', true);
  const before = JSON.stringify(f.actor.nativeMotion), first = sampleNraMotion(f.actor).headAim;
  for (let i = 0; i < 20; i++) sampleNraMotion(f.actor);
  advanceNraMotion(f.actor, 0);
  assert.equal(JSON.stringify(f.actor.nativeMotion), before);
  assert.deepEqual(sampleNraMotion(f.actor).headAim, first);
  assert.throws(() => { first.eye[0] = 100; }, TypeError);
  assert.throws(() => createHeadAimProfile(f.normalized, f.bones, f.idle, f.postures, []), /eye surface/);
});

test('raising, releasing and reloading use a continuous owned head blend independent of rendering history', () => {
  const f = fixture();
  f.project('standing', false);
  const unseen = { ...f.actor, nativeMotion: structuredClone(f.actor.nativeMotion) };
  for (const ready of [true, false, true]) {
    f.actor.rifleReady = unseen.rifleReady = ready;
    for (let frame = 0; frame < 90; frame++) {
      const before = f.actor.nativeMotion.cheekWeight;
      advanceNraMotion(f.actor, 1 / 60); advanceNraMotion(unseen, 1 / 60);
      assert.ok(Math.abs(f.actor.nativeMotion.cheekWeight - before) <= 1 - Math.exp(-1 / 60 / .12) + .001);
      for (let read = 0; read < 3; read++) sampleNraMotion(f.actor);
      assert.deepEqual(f.actor.nativeMotion.headGoal, unseen.nativeMotion.headGoal);
    }
    assert.equal(nativeAimReady(f.actor), ready);
    assert.deepEqual(sampleNraMotion(unseen).headAim, sampleNraMotion(f.actor).headAim);
  }
  f.actor.rifle = { action: 'reload' };
  assert.equal(nativeAimReady(f.actor), false);
  const weight = f.actor.nativeMotion.cheekWeight;
  advanceNraMotion(f.actor, 1 / 60);
  assert.ok(f.actor.nativeMotion.cheekWeight < weight && f.actor.nativeMotion.cheekWeight > .8);
  assert.equal(sampleNraMotion(f.actor).intent, 'reload');
});

test('constant single-key channels remain finite and an unreachable head target cannot authorize firing', () => {
  const f = fixture();
  const node = f.profile.headAim.chain.find(node => node.name === 'Head');
  f.profile.headAim.channels.standing.Head.scale = { times: [0], values: [...node.scale] };
  assert.ok(f.project('standing', true, 1.9).actual.projectionError < 1e-6);
  f.profile.rifleShoulderContacts.standing[0] += .8;
  const { pose } = f.project('standing', true, 2);
  assert.ok(pose.headAim.sightError > .004);
  assert.equal(nativeAimReady(f.actor), false);
  assert.ok(pose.headAim.parameters.every(Number.isFinite));
});
