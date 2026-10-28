import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNraGrenadeHand } from '../src/nra-hand.js';
import { createGrenadeRenderer, throwableViewPose } from '../src/grenade-renderer.js';
import { grenadePose, throwableProfile } from '../src/grenades.js';
import { createNraRiflePose, solveArm } from '../src/nra-rifle-pose.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { FIRING_POSES } from '../src/combat-posture.js';

const manager = new T.LoadingManager();
manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const rig = prepareNraRig(model), source = new T.Group(), bounds = new T.Box3().setFromObject(model);
source.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); source.rotation.y = Math.PI;
model.position.y -= bounds.min.y; source.add(model); source.updateMatrixWorld(true);

test('native throwable arms isolate authorized sleeve/skin, preserve source resources and solve a full unstretched chain', () => {
  const original = [...rig.canonical.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  for (const side of ['left', 'right']) {
    const arm = createNraGrenadeHand(source, side, { fullArm: true }), prefix = side === 'right' ? 'Right' : 'Left';
    const bones = new Map(), visible = [];
    arm.traverse(node => { if (node.isBone) bones.set(node.name, node); });
    arm.traverseVisible(node => { if (node.isMesh) visible.push(node); });
    assert.ok(visible.some(mesh => mesh.name === '衣服'));
    assert.ok(visible.every(mesh => mesh.isSkinnedMesh && ['衣服', '臂章', '手部'].includes(mesh.name)));
    for (const mesh of visible) {
      const native = rig.meshes.find(original => original.name === mesh.name);
      assert.equal(mesh.material, Array.isArray(native.material) ? native.material[0] : native.material);
      assert.notEqual(mesh.geometry, native.geometry);
      assert.deepEqual(mesh.geometry.attributes.uv.array, native.geometry.attributes.uv.array);
    }
    const positions = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.scale.clone()]);
    for (const kind of ['grenade', 'explosive-pack']) for (const phase of ['idle', 'drawing', 'cooking', 'throwing', 'recovering']) {
      for (const progress of [0, .25, .6, .9, 1]) {
        const profile = throwableProfile(kind), duration = profile[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
        const motion = throwableViewPose(phase === 'idle' ? null : { kind, phase, elapsed: progress * duration }, kind);
        const sign = side === 'right' ? 1 : -1;
        motion.wrist.x *= sign;
        const pole = motion.pole.clone(); pole.x *= sign;
        arm.poseArm(new T.Vector3(sign * .2, -.25, -.03), motion.wrist, motion.rotation, pole);
        const wristRotation = bones.get(prefix + 'Hand').quaternion.clone();
        arm.poseGrip(1 - motion.opening, 0, kind);
        assert.deepEqual(bones.get(prefix + 'Hand').quaternion.toArray(), wristRotation.toArray(), 'grip cache must not reset wrist IK');
        assert.ok(arm.armSnapshot.reachable && arm.armSnapshot.error < 1e-6, JSON.stringify(arm.armSnapshot));
        assert.ok(new T.Vector3(...arm.armSnapshot.frame).distanceTo(motion.wrist) < 1e-6);
        for (const [bone, position, scale] of positions) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale); }
      }
    }
  }
  for (const [bone, position, rotation] of original) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.quaternion.toArray(), rotation.toArray()); }
});

test('helper pinches with actual index/thumb endpoints, not a second imaginary item grip', () => {
  const hand = createNraGrenadeHand(source, 'left', { fullArm: true });
  hand.poseArm(new T.Vector3(-.2, -.25, -.03), new T.Vector3(-.1, -.25, -.30),
    new T.Quaternion(), new T.Vector3(-.8, -.65, .25));
  hand.posePreparation(1);
  const target = hand.attachmentFrame.localToWorld(new T.Vector3(...hand.userData.preparationGrip));
  for (const name of ['LeftHandIndex4', 'LeftHandThumb4']) {
    assert.ok(hand.getObjectByName(name).getWorldPosition(new T.Vector3()).distanceTo(target) < .003, name);
  }
});

test('presentation is continuous at phase boundaries and opens only in the final release interval', () => {
  for (const kind of ['grenade', 'explosive-pack']) {
    const p = throwableProfile(kind);
    const sample = (phase, elapsed) => throwableViewPose(phase ? { phase, elapsed, kind } : null, kind);
    for (const [first, second] of [[sample(null, 0), sample('drawing', 0)],
      [sample('drawing', p.draw), sample('cooking', 0)],
      [sample('cooking', 1), sample('throwing', 0)],
      [sample('throwing', p.windup), sample('recovering', 0)]]) {
      assert.ok(first.wrist.distanceTo(second.wrist) < 1e-8);
      assert.ok(first.rotation.angleTo(second.rotation) < 1e-7);
      assert.equal(first.opening, second.opening);
      assert.equal(first.preparation, second.preparation);
      assert.equal(first.guiding, second.guiding);
    }
    assert.equal(sample('throwing', p.windup * .87).opening, 0);
    assert.ok(sample('throwing', p.windup * .98).opening > .4);
    assert.ok(sample('throwing', p.windup).opening < .65, 'release is never a fully splayed palm');
  }
});

test('overhand load clears the head, keeps the shoulder fixed and withdraws a relaxed hand outside the central view', () => {
  const camera = new T.PerspectiveCamera(75, 1440 / 900, .025, 20);
  camera.updateMatrixWorld();
  for (const kind of ['grenade', 'explosive-pack']) {
    const profile = throwableProfile(kind);
    const loaded = throwableViewPose({ phase: 'cooking', elapsed: 0, kind }, kind);
    assert.ok(loaded.wrist.x >= .35 && loaded.wrist.z > .1 && loaded.wrist.y > 0, 'load is beside/behind the throwing shoulder');
    const arm = createNraGrenadeHand(source, 'right', { fullArm: true });
    for (const phase of ['idle', 'cooking', 'throwing', 'recovering']) for (let frame = 0; frame <= 100; frame++) {
      const progress = frame / 100, duration = phase === 'throwing' ? profile.windup : profile.recovery;
      const motion = throwableViewPose(phase === 'idle' ? null : { kind, phase, elapsed: progress * duration }, kind);
      arm.poseArm(new T.Vector3(.2, -.25, -.03), motion.wrist, motion.rotation, motion.pole);
      arm.poseGrip(1 - motion.opening, 0, kind);
      assert.ok(arm.armSnapshot.reachable && arm.armSnapshot.error < 1e-6);
      assert.ok(new T.Vector3(...arm.armSnapshot.shoulder).distanceTo(new T.Vector3(.2, -.25, -.03)) < 1e-8);
      const forearm = motion.wrist.clone().sub(new T.Vector3(...arm.armSnapshot.elbow)).normalize();
      assert.ok(forearm.dot(motion.forward) > .15, `${kind}/${phase}/${progress}: wrist must not fold back across the forearm`);
      if (phase === 'throwing' && motion.wrist.z > -.05) assert.ok(motion.wrist.x > .32, 'wrist never winds through the head');
      if (['idle', 'recovering'].includes(phase)) {
        assert.ok(motion.palm.dot(motion.wrist.clone().negate().normalize()) < .1, `${kind}/${phase}/${progress}: palm faces camera`);
      }
      if (phase === 'recovering') {
        assert.ok(arm.gripSnapshot.closure >= .4 && arm.gripSnapshot.closure <= .6, 'relaxed curled fingers throughout recovery');
        const projected = motion.wrist.clone().project(camera);
        assert.ok(Math.abs(projected.x) > .72 || Math.abs(projected.y) > 1, 'recovery never occupies the central view');
        if (progress >= .48) {
          for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
            const tip = arm.getObjectByName(`RightHand${finger}4`).getWorldPosition(new T.Vector3()).project(camera);
            assert.ok(Math.abs(tip.x) > 1 || Math.abs(tip.y) > 1, 'relaxed fingertips have naturally left the view by mid-recovery');
          }
        }
      }
    }
  }
  const grenade = throwableViewPose({ kind: 'grenade', phase: 'drawing', elapsed: throwableProfile('grenade').draw * .65 });
  const pack = throwableViewPose({ kind: 'explosive-pack', phase: 'drawing', elapsed: throwableProfile('explosive-pack').draw * .65 });
  assert.ok(grenade.wrist.distanceTo(pack.wrist) > .035, 'heavier pack loads longer and farther outside the shoulder');
});

test('preparation cocks the right arm before cooking and leaves a relaxed angled left guide until forward release', () => {
  for (const kind of ['grenade', 'explosive-pack']) {
    const profile = throwableProfile(kind), loaded = throwableViewPose({ kind, phase: 'cooking', elapsed: 0 });
    const drawEnd = throwableViewPose({ kind, phase: 'drawing', elapsed: profile.draw });
    assert.ok(drawEnd.wrist.distanceTo(loaded.wrist) < 1e-8 && loaded.wrist.z > .1);
    assert.equal(loaded.guiding, 1);
    const cameraDirection = loaded.guide.wrist.clone().negate().normalize();
    assert.ok(loaded.guide.palm.dot(cameraDirection) * loaded.guide.palmSide < .1, 'guide is angled away, not a camera-facing open palm');
    let previousZ = loaded.wrist.z;
    for (let frame = 0; frame <= 100; frame++) {
      const sample = throwableViewPose({ kind, phase: 'throwing', elapsed: profile.windup * frame / 100 });
      assert.ok(sample.wrist.z <= previousZ + 1e-10, 'release has no second backswing');
      previousZ = sample.wrist.z;
    }
  }
});

test('shared world overhand pose remains reachable and preserves the exact legacy physical launch position', () => {
  const avatar = clone(source), bones = new Map();
  avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const rest = ['RightArm', 'RightForeArm', 'RightHand'].map(name => [bones.get(name), bones.get(name).quaternion.clone()]);
  for (const kind of ['grenade', 'explosive-pack']) {
    const profile = throwableProfile(kind);
    for (const phase of ['drawing', 'cooking', 'throwing', 'recovering']) for (let frame = 0; frame <= 50; frame++) {
      for (const [bone, rotation] of rest) bone.quaternion.copy(rotation);
      avatar.updateMatrixWorld(true);
      const duration = phase === 'drawing' ? profile.draw : phase === 'throwing' ? profile.windup : profile.recovery;
      const pose = grenadePose({ kind, phase, elapsed: duration * frame / 50 });
      const result = solveArm(bones.get('RightArm'), bones.get('RightForeArm'), bones.get('RightHand'),
        new T.Vector3(...pose.hand), new T.Vector3(...pose.view.pole));
      assert.ok(result.reachable && result.error < 1e-6, `${kind}/${phase}/${frame}: ${JSON.stringify(result)}`);
    }
    for (const eye of [.45, .92, 1.67]) {
      const launch = grenadePose({ kind, phase: 'throwing', elapsed: profile.windup }, eye);
      assert.ok(new T.Vector3(...launch.position).distanceTo(new T.Vector3(.32, eye - .01, -.48)) < 1e-12);
      const recovery = grenadePose({ kind, phase: 'recovering', elapsed: 0 }, eye);
      assert.deepEqual(recovery.hand, launch.hand);
    }
  }
});

test('third-person grenade arm consumes the same overhand wrist, elbow hint and natural hand roll', () => {
  const root = new T.Group(), avatar = clone(source), bones = new Map(), gun = new T.Group();
  root.add(avatar); root.updateMatrixWorld(true);
  avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const rifle = createNraRiflePose(root, bones, gun);
  for (const kind of ['grenade', 'explosive-pack']) for (const [phase, progress] of [
    ['cooking', 0], ['throwing', .52], ['throwing', 1], ['recovering', .5],
  ]) {
    const profile = throwableProfile(kind), duration = phase === 'throwing' ? profile.windup : profile.recovery;
    const grenade = grenadePose({ kind, phase, elapsed: progress * duration });
    rifle.update({ weaponPosition: [.1, 1.3, -.25], weaponQuaternion: [0, 0, 0, 1], grenade });
    const wrist = bones.get('RightHand').getWorldPosition(new T.Vector3());
    assert.ok(wrist.distanceTo(new T.Vector3(...grenade.hand)) < 1e-6);
    const forward = bones.get('RightHandMiddle1').getWorldPosition(new T.Vector3()).sub(wrist).normalize();
    const across = bones.get('RightHandIndex1').getWorldPosition(new T.Vector3())
      .sub(bones.get('RightHandPinky1').getWorldPosition(new T.Vector3())).normalize();
    const palm = across.cross(forward).normalize(), expected = new T.Vector3(...grenade.view.palm);
    expected.addScaledVector(forward, -expected.dot(forward)).normalize();
    assert.ok(palm.dot(expected) > .9999, `${kind}/${phase}: world and first-person palm roll must agree`);
  }
});

test('actual crouched and prone skeletons keep both throwing and guiding arms reachable and clear of head and ground', () => {
  const root = new T.Group(), avatar = clone(source), bones = new Map(), meshes = [];
  root.add(avatar); root.updateMatrixWorld(true);
  avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) meshes.push(node); });
  const postures = createNativePosturePoses(avatar, bones), mixer = new T.AnimationMixer(meshes[0]);
  const rest = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  const rifle = createNraRiflePose(root, bones, new T.Group());
  for (const stance of ['standing', 'crouched', 'prone']) {
    mixer.stopAllAction();
    for (const [bone, position, rotation] of rest) { bone.position.copy(position); bone.quaternion.copy(rotation); }
    if (stance !== 'standing') { const action = mixer.clipAction(postures[stance].clip); action.play(); action.paused = true; action.time = 0; mixer.update(0); }
    root.updateMatrixWorld(true);
    const shoulders = ['RightArm', 'LeftArm'].map(name => bones.get(name).getWorldPosition(new T.Vector3()));
    const eye = FIRING_POSES[stance]?.eye ?? 1.67;
    for (const kind of ['grenade', 'explosive-pack']) for (const phase of ['drawing', 'cooking', 'throwing', 'recovering']) {
      for (let step = 0; step <= 20; step++) {
        const profile = throwableProfile(kind), duration = profile[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
        const grenade = grenadePose({ kind, phase, elapsed: duration * step / 20 }, eye);
        rifle.update({ weaponPosition: postures[stance]?.carry.positions.slice(0, 3) ?? [.1, 1.3, -.25],
          weaponQuaternion: [0, 0, 0, 1], grenade });
        const wrist = bones.get('RightHand').getWorldPosition(new T.Vector3());
        assert.ok(wrist.distanceTo(new T.Vector3(...grenade.hand)) < 1e-6, `${stance}/${kind}/${phase}/${step}: unreachable throwing wrist`);
        for (const [index, side] of ['Right', 'Left'].entries()) {
          assert.ok(bones.get(side + 'Arm').getWorldPosition(new T.Vector3()).distanceTo(shoulders[index]) < 1e-8,
            `${stance}/${side}/${phase}: shoulder must stay attached to the original body`);
          if (side === 'Right' || grenade.view.guiding === 1) {
            const elbow = bones.get(side + 'ForeArm').getWorldPosition(new T.Vector3());
            const hand = bones.get(side + 'Hand').getWorldPosition(new T.Vector3());
            assert.ok(elbow.y >= .025 && hand.y >= .09, `${stance}/${side}/${phase}: arm intersects ground`);
            assert.ok(hand.distanceTo(bones.get('Head').getWorldPosition(new T.Vector3())) > .14, `${stance}: hand winds through head`);
          }
        }
        if (grenade.view.guiding === 1) assert.ok(bones.get('LeftHand').getWorldPosition(new T.Vector3())
          .distanceTo(new T.Vector3(...grenade.guideHand)) < 1e-6);
      }
    }
  }
});

test('native and diagnostic renderers preserve hiding, item ownership and solved wrist attachment', () => {
  for (const native of [true, false]) {
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(), hands = [];
    scene.add(camera); camera.position.set(1, 2, 3); camera.rotation.set(.3, -.5, .2);
    const renderer = native ? createGrenadeRenderer(scene, camera, side => {
      const hand = createNraGrenadeHand(source, side, { fullArm: true }); hands.push(hand); return hand;
    }) : createGrenadeRenderer(scene, camera);
    const actor = { id: 'owner', health: 100, grenades: { ammo: 1, packs: 1, action: null } };
    for (const kind of ['grenade', 'explosive-pack']) {
      for (const phase of ['idle', 'drawing', 'cooking', 'throwing', 'recovering']) {
        for (const progress of [...Array.from({ length: 21 }, (_, index) => index / 20), .72]) {
          const profile = throwableProfile(kind), duration = profile[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
          actor.grenades.action = phase === 'idle' ? null : { phase, kind, elapsed: progress * duration };
          renderer.update([], actor, true, true, kind);
          assert.equal(renderer.snapshot.handVisible, true);
          assert.equal(renderer.snapshot.heldVisible, phase !== 'recovering');
          if (native) assert.ok(renderer.snapshot.arms.every(arm => arm.reachable && arm.error < 1e-6),
            `${kind}/${phase}: ${JSON.stringify(renderer.snapshot.arms)}`);
          if (native && phase === 'drawing' && progress === .3) {
            const held = hands[1].parent.children.find(node => node.visible &&
              node.getObjectByName(kind === 'grenade' ? 'safety-ring' : 'pull-handle'));
            const handle = held.getObjectByName(kind === 'grenade' ? 'safety-ring' : 'pull-handle');
            const target = kind === 'grenade' ? handle.localToWorld(new T.Vector3(.009, .067, .011)) : handle.getWorldPosition(new T.Vector3());
            for (const finger of ['Index', 'Thumb']) assert.ok(
              hands[0].getObjectByName(`LeftHand${finger}4`).getWorldPosition(new T.Vector3()).distanceTo(target) < .003);
          }
          if (native && phase === 'cooking') {
            assert.equal(renderer.snapshot.guideGrip.closure, .60);
            assert.ok(hands[1].attachmentFrame.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorld.clone().invert()).z > .1);
            const guide = hands[0].attachmentFrame.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorld.clone().invert());
            assert.ok(Math.abs(guide.x) < .25 && guide.y > -.3 && guide.z < -.35, 'left guide stays naturally forward while waiting');
          }
        }
      }
    }
    actor.grenades = { ammo: 0, packs: 0, action: null };
    renderer.update([], actor, true, true);
    assert.equal(renderer.snapshot.handVisible, false);
    renderer.clear();
    assert.equal(renderer.snapshot.views, 0);
  }
});
