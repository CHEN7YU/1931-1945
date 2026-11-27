import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNraGrenadeHand } from '../src/nra-hand.js';
import { createWeaponHands, WEAPON_HAND_GRIPS } from '../src/weapon-hands.js';
import { rifleModel, updateRifleModel } from '../src/rifle-model.js';
import { createRifleState, infantryWeaponProfile, rifleReloadSeconds } from '../src/rifle-action.js';
import { applyCloseWeaponPose } from '../src/weapon-close-pose.js';
import { RIFLE_IRON_AIM, RIFLE_IRON_SIGHTS } from '../src/rifle-contacts.js';
import { SMG_MAGAZINE } from '../src/submachine-gun-model.js';
import { machineGunReloadPose } from '../src/machine-gun-reload.js';

const manager = new T.LoadingManager();
manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
prepareNraRig(model);
const source = new T.Group(), bounds = new T.Box3().setFromObject(model);
source.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); source.rotation.y = Math.PI;
model.position.y -= bounds.min.y; source.add(model); source.updateMatrixWorld(true);

test('SMG reload uses the real magazine dimensions and keeps both native arms reachable', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  const state = { ...createRifleState('sigm1920'), action: 'reload', ammo: 0 }, gun = rifleModel(state);
  const previous = {};
  for (let frame = 0; frame <= 1000; frame++) {
    const fraction = frame / 1000;
    state.elapsed = 3.2 * fraction;
    const pose = updateRifleModel(gun, state);
    gun.position.set(.18, -.22 + .125 * pose.lower - gun.userData.reloadContact.viewDrop, -.14 - .1 * pose.lower);
    gun.rotation.set(-.14 * pose.lower, 0, .02 * pose.lower);
    view.update(gun, state);
    assert.equal(view.snapshot.visible, true, `frame ${frame}`);
    for (const side of ['left', 'right']) {
      const arm = view.snapshot[side].arm;
      assert.ok(arm.reachable && arm.error < .002, `${side} frame ${frame}`);
      assert.ok(Math.abs(new T.Vector3(...arm.shoulder).distanceTo(new T.Vector3(...arm.elbow)) - arm.lengths[0]) < 1e-6);
      assert.ok(Math.abs(new T.Vector3(...arm.elbow).distanceTo(new T.Vector3(...arm.wrist)) - arm.lengths[1]) < 1e-6);
      const joints = ['elbow', 'wrist'].map(name => new T.Vector3(...arm[name]).applyMatrix4(gun.matrix));
      const rotation = gun.quaternion.clone().multiply(new T.Quaternion(...view.snapshot[side].rotation));
      if (previous[side]) {
        joints.forEach((point, index) => assert.ok(point.distanceTo(previous[side].joints[index]) < .012,
          `${side} frame ${frame}: ${index ? 'wrist' : 'elbow'} jumps`));
        assert.ok(rotation.angleTo(previous[side].rotation) < .08, `${side} frame ${frame}: hand turns discontinuously`);
      }
      previous[side] = { joints, rotation };
    }
    if (fraction >= .15 && fraction <= .8) {
      const feed = gun.getObjectByName(gun.getObjectByName('spare-magazine').visible ? 'spare-magazine' : 'feed');
      const hand = view.root.getObjectByName('left-grenade-hand');
      assert.equal(view.snapshot.left.grip.weights['smg-magazine'], 1);
      for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
        const tip = feed.worldToLocal(hand.getObjectByName(`LeftHand${finger}4`).getWorldPosition(new T.Vector3()));
        tip.sub(new T.Vector3(...SMG_MAGAZINE.center));
        const clearance = Math.max(Math.abs(tip.y) - SMG_MAGAZINE.size[1] / 2,
          Math.abs(tip.z) - SMG_MAGAZINE.size[2] / 2);
        assert.ok(Math.abs(tip.x) < SMG_MAGAZINE.size[0] / 2 && clearance > .0024 && clearance < .008,
          `${finger} frame ${frame}: ${tip.toArray()} clearance ${clearance}`);
      }
      assert.ok(view.snapshot.left.wristAngle < 65 * Math.PI / 180,
        `left wrist frame ${frame}: ${view.snapshot.left.wristAngle * 180 / Math.PI}`);
    }
  }
});

test('SMG changes magazines only after the actual left hand and magazine leave the view', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  const state = { ...createRifleState('sigm1920'), action: 'reload', ammo: 0 }, gun = rifleModel(state);
  const camera = new T.PerspectiveCamera(72, 1.6, .1, 1000);
  camera.updateMatrixWorld(true);
  let previous = null;
  for (let frame = 240; frame <= 650; frame++) {
    const fraction = frame / 1000;
    state.elapsed = 3.2 * fraction;
    const pose = updateRifleModel(gun, state);
    const reload = machineGunReloadPose(state, { firstPerson: true });
    gun.position.set(.18, -.22 + .125 * pose.lower - reload.viewDrop, -.14 - .1 * pose.lower);
    gun.rotation.set(-.14 * pose.lower, 0, .02 * pose.lower);
    view.update(gun, state);
    assert.equal(view.snapshot.visible, true, `frame ${frame}`);
    const joints = ['left', 'right'].flatMap(side => ['elbow', 'wrist'].map(name =>
      new T.Vector3(...view.snapshot[side].arm[name]).applyMatrix4(gun.matrix)));
    if (previous) joints.forEach((point, index) => assert.ok(point.distanceTo(previous[index]) < .012,
      `frame ${frame}: ${index < 2 ? 'left' : 'right'} ${index % 2 ? 'wrist' : 'elbow'} jumps`));
    previous = joints;
    if (frame < 390 || frame > 410) continue;
    const hand = view.root.getObjectByName('left-grenade-hand');
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
      for (let joint = 1; joint <= 4; joint++) {
        const point = hand.getObjectByName(`LeftHand${finger}${joint}`).getWorldPosition(new T.Vector3()).project(camera);
        assert.ok(point.y < -1, `${fraction}: ${finger}${joint} remains in view at ${point.y}`);
      }
    }
    const feed = gun.getObjectByName(reload.spareVisible ? 'spare-magazine' : 'feed');
    const center = new T.Vector3(...SMG_MAGAZINE.center);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const point = center.clone().add(new T.Vector3(x, y, z).multiply(new T.Vector3(...SMG_MAGAZINE.size)).multiplyScalar(.5));
      const screen = feed.localToWorld(point).project(camera);
      assert.ok(screen.y < -1, `${fraction}: magazine remains in view at ${screen.y}`);
    }
  }
});

test('SMG reload keeps its owned arm contacts while entering and leaving close-ready presentation', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  const state = { ...createRifleState('sigm1920'), action: 'reload', ammo: 0 }, gun = rifleModel(state);
  for (const fraction of [0, .08, .15, .23, .35, .45, .65, .79, .9, 1]) {
    state.elapsed = 3.2 * fraction;
    const pose = updateRifleModel(gun, state), original = structuredClone(state);
    const drop = machineGunReloadPose(state, { firstPerson: true }).viewDrop;
    let previous = null;
    for (let frame = 0; frame <= 800; frame++) {
      const blend = frame <= 400 ? frame / 400 : (800 - frame) / 400;
      gun.position.set(.18, -.22 + .125 * pose.lower - drop, -.14 - .1 * pose.lower);
      gun.rotation.set(-.14 * pose.lower, 0, .02 * pose.lower);
      applyCloseWeaponPose(gun, blend);
      view.update(gun, state);
      assert.equal(view.snapshot.visible, true, `${fraction}/${frame}: close-ready stowed the hands`);
      const joints = ['left', 'right'].flatMap(side => ['elbow', 'wrist'].map(name =>
        new T.Vector3(...view.snapshot[side].arm[name]).applyMatrix4(gun.matrix)));
      for (const side of ['left', 'right'])
        assert.ok(view.snapshot[side].arm.reachable && view.snapshot[side].arm.error < .002);
      if (previous) joints.forEach((point, index) => assert.ok(point.distanceTo(previous[index]) < .005,
        `${fraction}/${frame}: ${index < 2 ? 'left' : 'right'} ${index % 2 ? 'wrist' : 'elbow'} ` +
          `jumps ${point.distanceTo(previous[index])} from ${previous[index].toArray()} to ${point.toArray()}`));
      previous = joints;
      assert.deepEqual(state, original);
    }
  }
});

test('iron aiming aligns the visible rear shoulders with the front tip without moving the real grips', () => {
  const state = createRifleState(), gun = rifleModel(state);
  const body = gun.getObjectByName('rifleBody'), original = structuredClone(state);
  const rear = new T.Vector3(...RIFLE_IRON_SIGHTS.rear);
  const front = new T.Vector3(...RIFLE_IRON_SIGHTS.front);
  gun.position.set(0, RIFLE_IRON_AIM.y, -.2); gun.rotation.x = RIFLE_IRON_AIM.pitch;
  gun.updateMatrixWorld(true);
  const projectedRear = gun.localToWorld(rear.clone()), projectedFront = gun.localToWorld(front.clone());
  assert.ok(Math.abs(projectedRear.y) < 1e-10 && Math.abs(projectedFront.y) < 1e-10);
  assert.ok(rear.y > .05, 'use the visible shoulders, not the bottom of the V notch');
  const shoulders = [-.008, .008].map(x => gun.localToWorld(new T.Vector3(x, rear.y, rear.z)));
  assert.ok(shoulders.every(point => Math.abs(point.y) < 1e-10));
  assert.ok(shoulders[0].x < projectedFront.x && shoulders[1].x > projectedFront.x);
  for (const expected of [new T.Vector3(-.004, .055, -.36), new T.Vector3(.004, .055, -.36),
    new T.Vector3(.0009, .05, -.857)]) {
    let nearest = Infinity;
    body.traverse(child => {
      if (!child.isMesh) return;
      const positions = child.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++)
        nearest = Math.min(nearest, new T.Vector3().fromBufferAttribute(positions, index).distanceTo(expected));
    });
    assert.ok(nearest < .0005, `alignment must reference real sight vertices, not metadata alone: ${expected.toArray()}`);
  }
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  updateRifleModel(gun, state); view.update(gun, state);
  assert.equal(view.snapshot.visible, true);
  for (const side of ['left', 'right']) assert.ok(view.snapshot[side].arm.reachable);
  assert.deepEqual(state, original);
});

test('reported near-wall retraction stows an unreachable presentation and recovers without ending combat', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  const state = createRifleState(), gun = rifleModel(state);
  const before = structuredClone(state);
  gun.position.set(.2030264526370948, -.3163574034258855, .45708560393959285);
  gun.rotation.set(-.55, 0, 0);
  updateRifleModel(gun, state);
  view.update(gun, state);
  assert.equal(view.root.visible, false);
  assert.equal(view.snapshot.reachLimited, true);
  assert.equal(view.snapshot.reason, 'weapon-outside-arm-workspace');
  assert.ok(view.snapshot.contacts.some(contact => contact.side === 'left'));
  assert.deepEqual(state, before, 'presentation limits cannot change health, ammo or weapon action');
  for (const weapon of ['rifle', 'sniper', 'zb26', 'type11']) {
    const owned = createRifleState(weapon), model = rifleModel(owned);
    for (let frame = 0; frame <= 60; frame++) {
      const retract = frame / 60;
      model.position.set(.18, -.22 - .12 * retract, -.14 + .72 * retract);
      model.rotation.set(-.55 * retract, 0, 0);
      updateRifleModel(model, owned);
      view.update(model, owned);
      if (view.snapshot.visible) for (const side of ['left', 'right']) {
        assert.ok(view.snapshot[side].arm.reachable && view.snapshot[side].arm.error < .002);
      }
    }
    model.position.set(.18, -.22, -.14); model.rotation.set(0, 0, 0);
    updateRifleModel(model, owned); view.update(model, owned);
    assert.equal(view.snapshot.visible, true);
    assert.equal(view.snapshot.reachLimited, false, 'walking away restores the actual hand view');
  }
  gun.position.x = NaN;
  assert.throws(() => view.update(gun, state), /finite/);
});

test('native weapon hands preserve distinct finger bones and source skin while sharing one reusable pair', () => {
  const sourceSkin = source.getObjectByName('\u624b\u90e8').material;
  const originalMaterial = Array.isArray(sourceSkin) ? sourceSkin[0] : sourceSkin;
  const originalColor = originalMaterial.color.clone();
  let created = 0;
  const view = createWeaponHands(side => { created++; return createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }); });
  const positions = [];
  view.root.traverse(node => { if (node.isBone) positions.push([node, node.position.clone(), node.scale.clone()]); });
  for (const weapon of ['rifle', 'sniper', 'zb26', 'type11']) {
    const state = createRifleState(weapon), gun = rifleModel(state);
    gun.position.set(.18, -.265, -.14);
    for (const action of ['idle', 'cycle', 'reload']) for (let frame = 0; frame <= 40; frame++) {
      state.action = action; state.ammo = action === 'reload' ? 0 : 4;
      state.elapsed = infantryWeaponProfile(state)[action === 'cycle' ? 'cycleSeconds' : 'reloadSeconds'] * frame / 40;
      updateRifleModel(gun, state); view.update(gun, state);
      assert.equal(view.root.parent, gun);
      for (const side of ['left', 'right']) {
        const sample = view.snapshot[side];
        assert.ok(sample.arm.reachable && sample.arm.error < .002);
        assert.equal(Object.keys(sample.grip.joints).length, 5);
        for (const [finger, chain] of Object.entries(sample.grip.joints)) for (let joint = 1; joint < chain.length; joint++) {
          const length = new T.Vector3(...chain[joint]).distanceTo(new T.Vector3(...chain[joint - 1]));
          assert.ok(Math.abs(length - sample.grip.fingerLengths[finger][joint - 1]) < 1e-6);
        }
        for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
          const curls = sample.grip.curls[finger];
          assert.ok(curls.every((angle, joint) => angle >= 0 && angle <= [1.25, 1.5, 1.05][joint] + 1e-6),
            `${finger} must flex within hinge limits instead of chasing arbitrary endpoints`);
        }
        if (action === 'idle' && weapon === 'rifle') {
          assert.ok(sample.wristAngle < 35 * Math.PI / 180,
            `${side}: stable forearm/palm alignment must stay below 35 degrees, got ${sample.wristAngle * 180 / Math.PI}`);
          if (side === 'left') {
            assert.ok(sample.palmNormal[1] > .8, 'support palm must face upward rather than pinch sideways');
            assert.equal(sample.elbowConstraint.limited, false, 'stable support must satisfy its elbow clearance without limiting');
            assert.ok(sample.arm.elbow[1] <= sample.arm.wrist[1] - .05 + 1e-5,
              `support elbow stays below the wrist: ${JSON.stringify(sample.arm)}`);
          }
        }
      }
      if (weapon === 'zb26' && action === 'reload' && frame === 24) {
        const joints = view.snapshot.left.grip.joints;
        assert.ok(joints.Index.at(-1)[2] < joints.Thumb.at(-1)[2] - .01,
          `thumb opposes the curled fingers: ${JSON.stringify({ index: joints.Index.at(-1), thumb: joints.Thumb.at(-1) })}`);
        for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
          const points = joints[finger].map(point => new T.Vector3(...point));
          const first = points[1].clone().sub(points[0]).normalize(), second = points[2].clone().sub(points[1]).normalize();
          const last = points[3].clone().sub(points[2]).normalize();
          assert.ok(Math.min(first.dot(second), second.dot(last)) < .95, `${finger} needs a real knuckle bend, not a straight rod`);
        }
        if (['rifle', 'sniper'].includes(weapon) && action === 'cycle' && frame === 16) {
          assert.equal(view.snapshot.right.grip.weights.bolt, 1);
          for (const finger of ['Index', 'Middle', 'Ring'])
            assert.ok(view.snapshot.right.grip.curls[finger][0] >= .79, 'the real native hand wraps instead of pinching');
          const grip = view.snapshot.right.grip, center = new T.Vector3(...WEAPON_HAND_GRIPS.right.bolt.center);
          assert.ok(new T.Vector3(...grip.joints.Thumb.at(-1)).distanceTo(center) < .02);
          assert.ok(new T.Vector3(...grip.joints.Index[2]).distanceTo(center) < .025);
        }
      }
    }
    assert.equal(gun.getObjectByName('leftHand').visible, false);
    assert.equal(gun.getObjectByName('rightHand').visible, false);
  }
  assert.equal(created, 2, 'weapon/member changes reuse the two native hand rigs');
  const rifle = createRifleState(), stableGun = rifleModel(rifle);
  for (const placement of [[0, -.05, -.2], [.18, -.22, -.14], [.18, -.265, -.14]]) {
    stableGun.position.fromArray(placement);
    updateRifleModel(stableGun, rifle); view.update(stableGun, rifle);
    for (const side of ['left', 'right']) {
      const hand = view.snapshot[side];
      assert.ok(hand.wristAngle < 35 * Math.PI / 180, `${side}: wrist alignment at ${placement}`);
      if (side === 'left') {
        assert.ok(hand.palmNormal[1] > .8);
        assert.equal(hand.elbowConstraint.limited, false);
        assert.ok(hand.arm.elbow[1] <= hand.arm.wrist[1] - .05 + 1e-5);
      }
    }
  }
  view.root.traverseVisible(mesh => {
    if (!mesh.isSkinnedMesh || !['\u8863\u670d', '\u81c2\u7ae0'].includes(mesh.name)) return;
    const weights = mesh.geometry.attributes.skinWeight, joints = mesh.geometry.attributes.skinIndex;
    assert.ok(mesh.geometry.attributes.uv);
    for (let vertex = 0; vertex < weights.count; vertex++) {
      let total = 0;
      for (let slot = 0; slot < 4; slot++) {
        const weight = weights.getComponent(vertex, slot);
        total += weight;
        if (weight > .001) assert.match(mesh.skeleton.bones[joints.getComponent(vertex, slot)].name,
          /^(Left|Right)(Arm|ForeArm|Hand)$/, 'cloth cannot follow individual thumb/finger joints');
      }
      assert.ok(Math.abs(total - 1) < 1e-5, 'cut-edge weights stay normalized');
    }
  });

  const lowered = rifleModel();
  view.update(lowered, createRifleState());
  lowered.position.y = -.55;
  view.update(lowered, createRifleState(), { stowed: true });
  assert.equal(view.root.visible, false, 'traversal stows the native arms instead of stretching them');
  lowered.position.y = -.22;
  view.update(lowered, createRifleState());
  assert.equal(view.root.visible, true);
  view.update(lowered, createRifleState(), { appearance: { key: 'test-complexion', skin: '#d7b797' } });
  view.root.traverseVisible(mesh => {
    if (mesh.name !== '\u624b\u90e8') return;
    assert.notEqual(mesh.material, originalMaterial);
    assert.equal(mesh.material.map, originalMaterial.map);
    assert.equal(mesh.material.color.getHexString(), 'd7b797');
  });
  assert.deepEqual(originalMaterial.color, originalColor, 'first-person tint cannot recolor characters or throwable hands');
  for (const [bone, position, scale] of positions) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale); }
  const middle = view.snapshot.left.grip.fingerLengths.Middle.reduce((sum, value) => sum + value, 0);
  const pinky = view.snapshot.left.grip.fingerLengths.Pinky.reduce((sum, value) => sum + value, 0);
  assert.ok(middle - pinky > .01, 'real middle and pinky fingers cannot become equal-length rods');
});

test('close-ready transitions keep both native contacts reachable through aim, posture, cycling and reload', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  for (const weapon of ['rifle', 'sniper', 'zb26', 'type11']) {
    const state = createRifleState(weapon), gun = rifleModel(state);
    for (const placement of [[0, -.05, -.2], [.18, -.22, -.14], [.18, -.265, -.14]]) {
      for (const action of ['idle', 'cycle', 'reload']) for (let frame = 0; frame <= 20; frame++) {
        state.action = action;
        state.elapsed = (action === 'reload' ? rifleReloadSeconds(state) :
          infantryWeaponProfile(state).cycleSeconds) * frame / 20;
        const pose = updateRifleModel(gun, state);
        for (let step = 0; step <= 20; step++) {
          gun.position.fromArray(placement); gun.position.y -= pose.lower * .045;
          gun.rotation.set(-pose.lower * .14, 0, -pose.lower * .08);
          applyCloseWeaponPose(gun, step / 20);
          view.update(gun, state);
          const description = `${weapon}/${placement}/${action}/${frame}/${step}`;
          assert.equal(view.snapshot.visible, true, description);
          assert.equal(view.snapshot.reachLimited, false, description);
          for (const side of ['left', 'right']) {
            const arm = view.snapshot[side].arm;
            assert.ok(arm.reachable && arm.error < .002, description);
            assert.ok(Math.abs(new T.Vector3(...arm.shoulder).distanceTo(new T.Vector3(...arm.elbow)) - arm.lengths[0]) < 1e-6);
            assert.ok(Math.abs(new T.Vector3(...arm.elbow).distanceTo(new T.Vector3(...arm.wrist)) - arm.lengths[1]) < 1e-6);
          }
        }
      }
    }
  }
  assert.throws(() => applyCloseWeaponPose(rifleModel(), NaN), RangeError);
});

test('ordinary close-ready entry and exit do not pop visible wrists or elbows', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  for (const weapon of ['rifle', 'sniper', 'zb26', 'type11']) {
    const state = createRifleState(weapon), gun = rifleModel(state);
    for (const placement of [[0, -.05, -.2], [.18, -.22, -.14]]) {
      let previous = null;
      for (let frame = 0; frame <= 240; frame++) {
        const blend = frame <= 120 ? frame / 120 : (240 - frame) / 120;
        gun.position.fromArray(placement); gun.rotation.set(0, 0, 0);
        applyCloseWeaponPose(gun, blend); updateRifleModel(gun, state); view.update(gun, state);
        const points = ['left', 'right'].flatMap(side => ['wrist', 'elbow'].map(joint =>
          new T.Vector3(...view.snapshot[side].arm[joint]).applyMatrix4(gun.matrix)));
        if (previous) for (let joint = 0; joint < points.length; joint++) {
          assert.ok(points[joint].distanceTo(previous[joint]) < .03,
            `${weapon}/${placement}/${frame}: visible arm joint changed discontinuously`);
        }
        previous = points;
      }
    }
  }
});

test('LMG reload elbows follow the loading palm continuously without folding above a raised wrist', () => {
  const view = createWeaponHands(side => createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }));
  for (const weapon of ['zb26', 'type11']) {
    const state = { ...createRifleState(weapon), action: 'reload', ammo: 0 }, gun = rifleModel(state);
    for (const placement of [[.18, -.22, -.14], [.18, -.265, -.14]]) {
      gun.position.fromArray(placement);
      let previous = null;
      for (let frame = 0; frame <= 720; frame++) {
        state.elapsed = infantryWeaponProfile(state).reloadSeconds * frame / 720;
        const pose = updateRifleModel(gun, state);
        gun.rotation.set(-pose.lower * .14, 0, -pose.lower * .08);
        view.update(gun, state);
        const sample = view.snapshot.left, { shoulder, elbow, wrist, lengths } = sample.arm;
        const context = `${weapon} at ${placement}, frame ${frame}`;
        assert.ok(sample.arm.reachable && sample.arm.error < .002, context);
        assert.ok(Math.abs(new T.Vector3(...shoulder).distanceTo(new T.Vector3(...elbow)) - lengths[0]) < 1e-6, context);
        assert.ok(Math.abs(new T.Vector3(...elbow).distanceTo(new T.Vector3(...wrist)) - lengths[1]) < 1e-6, context);
        const down = new T.Vector3(0, -1, 0).transformDirection(gun.matrix.clone().invert());
        const clearance = new T.Vector3(...elbow).sub(new T.Vector3(...wrist)).dot(down);
        if (sample.elbowConstraint.requested > 0) assert.ok(
          clearance >= Math.min(sample.elbowConstraint.available, sample.elbowConstraint.requested) - 1e-5, context);
        if (previous && weapon === 'zb26') assert.ok(new T.Vector3(...elbow).distanceTo(previous) < .04,
          `${context}: elbow step ${new T.Vector3(...elbow).distanceTo(previous)}, ${previous.toArray()} -> ${elbow}`);
        previous = new T.Vector3(...elbow);
        if (weapon === 'zb26' && frame >= .12 * 720 && frame <= .86 * 720 &&
            gun.getObjectByName('feed').position.y >= 0) {
          assert.ok(sample.wristAngle < 35 * Math.PI / 180,
            `${context}: raised magazine/press wrist bends ${sample.wristAngle * 180 / Math.PI} degrees`);
        }
      }
    }
  }
});
