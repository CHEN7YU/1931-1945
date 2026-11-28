import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { createCasualtyPose, createCasualtyState } from '../src/casualties.js';

function fixture() {
  const manager = new T.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
  const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const { canonical: bones, meshes } = prepareNraRig(model);
  const root = new T.Group(), normalized = new T.Group(), gun = new T.Group();
  const bounds = new T.Box3().setFromObject(model);
  normalized.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); normalized.rotation.y = Math.PI;
  model.position.y -= bounds.min.y; normalized.add(model); root.add(normalized, gun); root.updateMatrixWorld(true);
  const postures = createNativePosturePoses(normalized, bones);
  const data = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url)));
  const mixer = new T.AnimationMixer(meshes[0]);
  const actions = { standing: mixer.clipAction(T.AnimationClip.parse(data.idle)),
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, mixer.clipAction(value.clip)])) };
  for (const action of Object.values(actions)) { action.play(); action.paused = true; }
  const rest = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  const apply = createCasualtyPose(root, bones, gun, (_x, _z, floor) => floor);
  const poses = {};
  for (const stance of Object.keys(actions)) {
    for (const [bone, position, quaternion] of rest) { bone.position.copy(position); bone.quaternion.copy(quaternion); }
    for (const [name, action] of Object.entries(actions)) {
      action.time = name === 'standing' ? .4 : 0; action.setEffectiveWeight(Number(name === stance));
    }
    mixer.update(0);
    poses[stance] = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  }
  return {
    sample(actor, time, stance = 'standing') {
      for (const [bone, position, quaternion] of poses[stance]) { bone.position.copy(position); bone.quaternion.copy(quaternion); }
      root.position.copy(actor.position); root.rotation.set(0, actor.heading, 0); gun.position.set(0, 1, 0);
      gun.quaternion.identity();
      root.updateMatrixWorld(true);
      apply(actor, time);
      return { ...Object.fromEntries([...bones].map(([name, bone]) => [name, bone.getWorldPosition(new T.Vector3())])),
        kneeHingeAxis: new T.Vector3(1, 0, 0).transformDirection(root.matrixWorld) };
    },
  };
}

const bend = (points, side, upper, lower, end) => {
  const a = points[side + lower].clone().sub(points[side + upper]).normalize();
  const b = points[side + end].clone().sub(points[side + lower]).normalize();
  return a.angleTo(b);
};

test('real soldier rig settles with bent asymmetric knees and relaxed grounded elbows, not straight-legged hand support', () => {
  const view = fixture();
  for (const variant of [0, 1, 2, 3]) for (const retainGun of [false, true]) {
    const actor = { id: 'casualty-shape', health: 0, heading: .6, position: new T.Vector3(3, 8.58, -4) };
    actor.casualty = createCasualtyState(actor, 0, null, { variant, retainGun });
    const points = view.sample(actor, 3), floor = actor.position.y, description = `${variant}/${retainGun}`;
    assert.ok(bend(points, 'Left', 'UpLeg', 'Leg', 'Foot') > .8, `left knee ${description}`);
    assert.ok(bend(points, 'Right', 'UpLeg', 'Leg', 'Foot') > .5, `right knee ${description}`);
    assert.ok(Math.abs(bend(points, 'Left', 'UpLeg', 'Leg', 'Foot') -
      bend(points, 'Right', 'UpLeg', 'Leg', 'Foot')) > .2, `asymmetric knees ${description}`);
    assert.ok(points.Head.y - floor < .5 && points.Spine2.y - floor < .4, `grounded trunk ${description}`);
    for (const side of ['Left', 'Right']) {
      const thigh = points[side + 'Leg'].clone().sub(points[side + 'UpLeg']).normalize();
      const shin = points[side + 'Foot'].clone().sub(points[side + 'Leg']).normalize();
      assert.ok(thigh.cross(shin).dot(points.kneeHingeAxis) < -.1,
        `knee must flex backwards rather than hyperextend ${description}/${side}`);
      assert.ok(bend(points, side, 'Arm', 'ForeArm', 'Hand') > .8, `unlocked elbow ${description}/${side}`);
      for (const part of ['UpLeg', 'Leg', 'Foot', 'Arm', 'ForeArm', 'Hand']) {
        assert.ok(points[side + part].y - floor >= .015, `ground clearance ${description}/${side}${part}: ${points[side + part].y - floor}`);
      }
      assert.ok(points[side + 'ForeArm'].y <= points[side + 'Arm'].y + .035, `elbow does not prop chest ${description}/${side}`);
    }
    const repeated = view.sample(actor, 3);
    assert.ok(Math.max(...Object.keys(points).map(name => points[name].distanceTo(repeated[name]))) < 1e-8,
      'paused samples do not accumulate joint rotations');
    assert.deepEqual(actor.position.toArray(), [3, 8.58, -4], 'render correction leaves collision/death placement untouched');
  }
});

test('compact side collapse preserves folded starting posture and bounded wall footprint through its transition', () => {
  const view = fixture();
  const actor = { id: 'casualty-compact', health: 0, heading: 0, position: new T.Vector3() };
  actor.casualty = Object.freeze({ ...createCasualtyState(actor, 0, null, { variant: 3, retainGun: false }), wallLimited: true });
  for (let frame = 0; frame <= 20; frame++) {
    const time = actor.casualty.duration * frame / 20, points = view.sample(actor, time, 'kneeling');
    assert.ok(Object.values(points).every(point => point.toArray().every(Number.isFinite)));
    if (frame === 20) {
      assert.ok(points.Head.y < .5 && points.Hips.y < .5);
      for (const side of ['Left', 'Right']) {
        assert.ok(bend(points, side, 'UpLeg', 'Leg', 'Foot') > .8, 'compact knees stay folded');
        assert.ok(points[side + 'Hand'].distanceTo(points.Hips) < .7, 'compact arms do not enlarge the wall footprint');
      }
    }
    const repeated = view.sample(actor, time, 'kneeling');
    assert.ok(Math.max(...Object.keys(points).map(name => points[name].distanceTo(repeated[name]))) < 1e-8);
  }
});

test('collapse transitions preserve limb lengths and the occupied floor from upright, kneeling and prone starts', () => {
  const view = fixture();
  for (const stance of ['standing', 'kneeling', 'prone']) for (const variant of [0, 1, 2, 3]) {
    const actor = { id: 'casualty-transition', health: 0, heading: -.7, position: new T.Vector3(-3, 8.58, 4) };
    actor.casualty = createCasualtyState(actor, 0, { prone: Number(stance === 'prone'), speed: stance === 'standing' ? 4.8 : 0 },
      { variant, retainGun: false });
    const snapshot = JSON.stringify(actor.casualty), original = view.sample(actor, 0, stance);
    for (let frame = 1; frame <= 20; frame++) {
      const points = view.sample(actor, actor.casualty.duration * frame / 20, stance);
      for (const name of ['Hips', 'Spine2', 'Head']) assert.ok(points[name].y >= actor.position.y + .04, `${stance}/${variant}/${frame}/${name}`);
      for (const side of ['Left', 'Right']) for (const chain of [['UpLeg', 'Leg', 'Foot'], ['Arm', 'ForeArm', 'Hand']]) {
        for (let segment = 0; segment < 2; segment++) {
          const a = side + chain[segment], b = side + chain[segment + 1];
          assert.ok(Math.abs(points[a].distanceTo(points[b]) - original[a].distanceTo(original[b])) < .001,
            `${stance}/${variant}/${frame}/${a}-${b}: ${points[a].distanceTo(points[b])} vs ${original[a].distanceTo(original[b])}`);
        }
      }
    }
    assert.equal(JSON.stringify(actor.casualty), snapshot);
  }
});
