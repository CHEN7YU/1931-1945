import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { createNativeGaitProfile, applyNativeUpperBody } from '../src/nra-gait.js';
import { createHeadAimProfile, createHeadAimProbe, projectHeadAim } from '../src/head-aim.js';
import { createNraMotion, sampleNraMotion, nativeEyeLocal, nativeMuzzleLocal, nativeAimReady, advanceNraMotion, syncNativeAimGoal } from '../src/nra-motion.js';
import { shoulderPocket } from '../src/rifle-contacts.js';
import { soldierEyePosition, soldierPostureHeight } from '../src/entities.js';
import { FIRING_POSES } from '../src/combat-posture.js';
import { createNraGrenadeHand } from '../src/nra-hand.js';

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

test('single-knee firing folds the rear calf under the body instead of stretching it far behind the hip', () => {
  const f = fixture();
  for (const stance of ['kneeling', 'crouched']) {
    f.project(stance, true);
    const local = name => f.bones.get(name).getWorldPosition(new T.Vector3()).sub(f.actor.position)
      .applyAxisAngle(new T.Vector3(0, 1, 0), -f.actor.heading);
    const hip = local('Hips'), rear = local('RightFoot'), knee = local('RightLeg'), front = local('LeftFoot');
    assert.ok(rear.z - hip.z < .35, `${stance}: rear foot extends ${rear.z - hip.z}m`);
    assert.ok(rear.z - front.z < .65);
    assert.ok(knee.y > .025 && knee.y < .13, `${stance}: supporting knee ${knee.y}`);
  }
});

test('grenade view reuses the authorized skinned hands and UVs with isolated finger bones and no retained body meshes', () => {
  const f = fixture();
  for (const side of ['left', 'right']) {
    const hand = createNraGrenadeHand(f.normalized, side), duplicate = createNraGrenadeHand(f.normalized, side);
    const prefix = side === 'right' ? 'Right' : 'Left', bones = new Map(), drawn = [];
    hand.traverse(node => { if (node.isBone) bones.set(node.name, node); });
    hand.traverseVisible(node => { if (node.isMesh) drawn.push(node); });
    assert.equal(drawn.length, 1); assert.equal(drawn[0].name, '\u624b\u90e8');
    assert.ok(drawn[0].isSkinnedMesh && drawn[0].geometry.attributes.uv);
    const first = bones.get(prefix + 'HandMiddle1'), second = bones.get(prefix + 'HandMiddle2');
    const before = first.getWorldPosition(new T.Vector3()).distanceTo(second.getWorldPosition(new T.Vector3()));
    hand.poseGrip(.85); hand.poseGrip(.85);
    assert.ok(Math.abs(before - first.getWorldPosition(new T.Vector3()).distanceTo(second.getWorldPosition(new T.Vector3()))) < 1e-8);
    assert.equal(duplicate.userData.handSource, 'nra-authorized-skinned-hand');
    for (const kind of ['grenade', 'explosive-pack']) {
      hand.poseGrip(1, 0, kind);
      assert.ok(hand.gripSnapshot.reachAdjustment < .001, `${side}/${kind}: contact cannot need stretched fingers`);
      const end = bones.get(prefix + 'HandMiddle4');
      const before = hand.worldToLocal(end.getWorldPosition(new T.Vector3()));
      hand.position.set(1, .2, -3); hand.rotation.set(.3, 1, -.4); hand.updateMatrixWorld(true);
      hand.poseGrip(1, 0, kind);
      assert.ok(hand.worldToLocal(end.getWorldPosition(new T.Vector3())).distanceTo(before) < 1e-8,
        'cached local finger contact is independent of camera/world transforms');
      const index = bones.get(prefix + 'HandIndex1'), closed = index.quaternion.clone().normalize();
      hand.poseGrip(1, .01, kind);
      const partial = closed.angleTo(index.quaternion.clone().normalize());
      hand.poseGrip(1, 1, kind);
      const full = closed.angleTo(index.quaternion.clone().normalize());
      assert.ok(partial < full * .02 + 1e-8, `${side}/${kind}: initial pin-pull angle ${partial}, full ${full}`);
    }
    assert.throws(() => hand.poseGrip(2), RangeError);
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

test('eye-only reuse preserves immutable local results, world projection and the head-free muzzle path', () => {
  const f = fixture();
  f.project('standing', true);
  const before = JSON.stringify(f.actor.nativeMotion), first = nativeEyeLocal(f.actor);
  for (let read = 0; read < 20; read++) {
    assert.equal(nativeEyeLocal(f.actor), first);
    soldierEyePosition(f.actor); soldierPostureHeight(f.actor);
  }
  advanceNraMotion(f.actor, 0);
  assert.equal(nativeEyeLocal(f.actor), first);
  assert.equal(JSON.stringify(f.actor.nativeMotion), before);
  assert.throws(() => { first[0] = 100; }, TypeError);
  f.actor.heading += .4; f.actor.position.y += .5;
  assert.equal(nativeEyeLocal(f.actor), first, 'world position is applied after local reuse');
  const eye = soldierEyePosition(f.actor);
  assert.ok(new T.Vector3(eye.x, eye.y, eye.z).distanceTo(new T.Vector3(...first)
    .applyAxisAngle(new T.Vector3(0, 1, 0), f.actor.heading).add(f.actor.position)) < 1e-8);
  const full = sampleNraMotion(f.actor), muzzle = nativeMuzzleLocal(f.actor);
  const expected = new T.Vector3(...f.profile.muzzle).applyQuaternion(new T.Quaternion(...full.weaponQuaternion))
    .add(new T.Vector3(...full.weaponPosition));
  assert.ok(expected.distanceTo(new T.Vector3(muzzle.x, muzzle.y, muzzle.z)) < 1e-10);
  assert.equal(Object.hasOwn(sampleNraMotion(f.actor, false), 'headAim'), false);
  f.actor.nativeMotion.cheekWeight = NaN;
  assert.throws(() => nativeEyeLocal(f.actor), /simulation-owned target/);
  f.actor.position.y = NaN;
  assert.throws(() => nativeEyeLocal(f.actor), /calibrated motion state/);
});

test('aim goal reuses the exactly matching head base and invalidates on pose or profile changes', () => {
  const f = fixture(), multiply = T.Matrix4.prototype.multiply;
  const count = callback => {
    let calls = 0;
    T.Matrix4.prototype.multiply = function (...args) { calls++; return multiply.apply(this, args); };
    try { return { value: callback(), calls }; }
    finally { T.Matrix4.prototype.multiply = multiply; }
  };
  f.project('standing', true, 1.1, .04);
  f.actor.nativeMotion.idleTime += .017;
  syncNativeAimGoal(f.actor);
  const motion = f.actor.nativeMotion, retainedGoal = motion.headGoal;
  const cached = count(() => sampleNraMotion(f.actor));
  const uncachedMotion = { ...motion, headGoal: Object.freeze({ ...retainedGoal }) };
  const uncached = count(() => sampleNraMotion({ ...f.actor, nativeMotion: uncachedMotion }));
  assert.deepEqual(cached.value, uncached.value);
  assert.equal(uncached.calls - cached.calls, f.profile.headAim.chain.length,
    'matching goal/input reuse must skip exactly one head-base transform chain');

  motion.idleTime += .013;
  const changedTime = count(() => sampleNraMotion(f.actor));
  const changedTimeMotion = { ...motion, headGoal: Object.freeze({ ...motion.headGoal }) };
  const changedTimeReference = count(() => sampleNraMotion({ ...f.actor, nativeMotion: changedTimeMotion }));
  assert.deepEqual(changedTime.value, changedTimeReference.value);
  assert.equal(changedTime.calls, f.profile.headAim.chain.length,
    'changing the animation sample time must force the base pose to be rebuilt');

  const pose = sampleNraMotion(f.actor), goal = motion.headGoal;
  const otherProfile = structuredClone(f.profile.headAim);
  const uncachedOtherProfile = count(() => projectHeadAim(otherProfile, pose,
    { headGoal: goal, cheekWeight: motion.cheekWeight }));
  assert.deepEqual(uncachedOtherProfile.value, pose.headAim);
  assert.equal(uncachedOtherProfile.calls, f.profile.headAim.chain.length,
    'a copied calibration profile must not reuse another profile object’s cached transform chain');
  assert.ok(Object.isFrozen(retainedGoal) && Object.isFrozen(retainedGoal.neckRotation));
});

test('unaimed eye reuse retains main sword carry semantics and invalidates when its pose appears or disappears', () => {
  const f = fixture();
  f.project('standing', false);
  f.actor.health = 100;
  f.actor.nativeMotion.profile = { ...f.profile, lowReadyCarry: true };
  f.actor.nativeMotion.lowReady = .2;
  f.actor.dadao = { equipped: false, pose: { phase: 'ready', progress: 0 } };
  for (const [equipped, pose] of [[false, null], [true, null], [true, { phase: 'ready', progress: 0 }],
    [true, { phase: 'cut', progress: .5 }], [true, null], [false, null]]) {
    Object.assign(f.actor.dadao, { equipped, pose });
    const before = JSON.stringify(f.actor.nativeMotion);
    assert.deepEqual(nativeEyeLocal(f.actor), sampleNraMotion(f.actor).headAim.eye);
    assert.equal(JSON.stringify(f.actor.nativeMotion), before);
  }
});

test('eye reuse invalidates on every mutable local pose input and is isolated from unseen soldiers', () => {
  const f = fixture();
  f.project('standing', true);
  const changes = [
    actor => { actor.nativeMotion.profile = structuredClone(actor.nativeMotion.profile); },
    ...['idleTime', 'distance', 'gaitCycles', 'phaseDistance', 'speed', 'strideScale', 'gaitCharge',
      'gaitAim', 'weight', 'aim', 'bodyLean', 'lowReady', 'legLift'].map(name =>
      actor => { actor.nativeMotion[name] += .05; }),
    actor => { actor.nativeMotion.position.x += .1; },
    actor => { actor.nativeMotion.position.z += .1; },
    actor => { actor.position.x += .1; },
    actor => { actor.position.z += .1; },
    actor => { actor.locomotion.mode = 'sprint'; },
    actor => { actor.rifleReady = false; },
    actor => { actor.rifle = { action: 'reload' }; },
    actor => { actor.nativeMotion.cheekWeight = .5; },
    actor => { actor.nativeMotion.headGoal = structuredClone(actor.nativeMotion.headGoal); },
    ...Object.keys(FIRING_POSES).map(name => actor => { actor.nativeMotion.posture[name] = .25; }),
  ];
  for (const change of changes) {
    const actor = { ...f.actor, position: f.actor.position.clone(), locomotion: { ...f.actor.locomotion },
      nativeMotion: structuredClone(f.actor.nativeMotion) };
    const first = nativeEyeLocal(actor);
    change(actor);
    assert.deepEqual(nativeEyeLocal(actor), sampleNraMotion(actor).headAim.eye, change.toString());
    const unseen = { ...actor, nativeMotion: structuredClone(actor.nativeMotion) };
    assert.deepEqual(nativeEyeLocal(unseen), nativeEyeLocal(actor));
    assert.equal(nativeEyeLocal(f.actor), sampleNraMotion(f.actor).headAim.eye);
    assert.equal(first.length, 3);
  }
});

test('unaimed eye-only projection is bit-exact across 5000 moving and blended calibrated poses', () => {
  const { actor, profile } = fixture();
  let seed = 1938;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  actor.health = 100;
  for (let index = 0; index < 5000; index++) {
    const motion = actor.nativeMotion;
    motion.profile = { ...profile, lowReadyCarry: index % 2 === 0 };
    const weights = Object.keys(FIRING_POSES).map(() => random()), total = weights.reduce((sum, value) => sum + value, 0);
    const blend = index % 3 ? random() : 0;
    motion.posture = Object.fromEntries(Object.keys(FIRING_POSES).map((name, i) => [name, weights[i] / total * blend]));
    Object.assign(motion, { cheekWeight: 0, idleTime: random() * 100, bodyLean: random() * .3,
      distance: random() * 20, speed: random() * 5, gaitCycles: random() * 20,
      gaitCharge: random(), gaitAim: random(), legLift: random(), strideScale: .8 + random() * .4,
      lowReady: random(), weight: random(), aim: random() });
    actor.rifleReady = index % 2 === 0;
    actor.locomotion.mode = index % 3 ? 'walk' : 'sprint';
    actor.position.x += .01; actor.position.z -= .01;
    const before = JSON.stringify(motion), expected = sampleNraMotion(actor).headAim.eye;
    assert.deepEqual(nativeEyeLocal(actor), expected, `pose ${index}`);
    assert.equal(JSON.stringify(motion), before);
    assert.ok(Object.isFrozen(nativeEyeLocal(actor)));
  }
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
