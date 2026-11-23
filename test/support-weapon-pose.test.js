import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { createSupportWeaponPose, supportWeaponTargets, supportWeaponPoseIndex,
  SUPPORT_WEAPON_BANKS } from '../src/support-weapon-pose.js';
import { createGrenadeDischargerModel } from '../src/grenade-discharger-model.js';
import { createEmplacementModel } from '../src/emplacement-model.js';
import { createEmplacement, emplacementLook, emplacementPose, emplacementObstacles,
  EMPLACEMENT_PROFILES } from '../src/emplacements.js';
import { circleBlocked } from '../src/core.js';
import { createNraGrenadeHand } from '../src/nra-hand.js';
import { createSupportViewHands } from '../src/support-view-hands.js';

function rig(team) {
  const root = new THREE.Group(), normalized = new THREE.Group();
  root.add(normalized);
  let bones;
  if (team === 'friendly') {
    const manager = new THREE.LoadingManager();
    manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new THREE.Texture(); } });
    const data = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
    const avatar = new FBXLoader(manager).parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    bones = prepareNraRig(avatar).canonical;
    const bounds = new THREE.Box3().setFromObject(avatar);
    normalized.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y));
    normalized.rotation.y = Math.PI; avatar.position.y -= bounds.min.y; normalized.add(avatar);
  } else {
    const data = readFileSync(new URL('../public/assets/game/ija-1938/character.glb', import.meta.url));
    const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    const joints = new Set(gltf.skins[0].joints); bones = new Map();
    const nodes = gltf.nodes.map((node, index) => {
      const object = joints.has(index) ? new THREE.Bone() : new THREE.Group(); object.name = node.name;
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
      if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
      if (joints.has(index)) bones.set(node.name, object);
      return object;
    });
    gltf.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
    for (const index of gltf.scenes[gltf.scene ?? 0].nodes) normalized.add(nodes[index]);
    normalized.rotation.y = Math.PI;
  }
  root.updateMatrixWorld(true); assert.equal(bones.size, 65);
  const rest = new Map([...bones].map(([name, bone]) => [name, {
    position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const poses = createNativePosturePoses(normalized, bones);
  const profile = {
    rifleContacts: { standing: bones.get('RightArm').getWorldPosition(new THREE.Vector3()).toArray(),
      ...Object.fromEntries(Object.entries(poses).map(([name, value]) => [name, value.shoulder])) },
    riflePivots: { standing: bones.get('Spine').getWorldPosition(new THREE.Vector3()).toArray(),
      ...Object.fromEntries(Object.entries(poses).map(([name, value]) => [name, value.pivot])) },
  };
  return { root, normalized, bones, profile, apply(stance) {
    for (const [name, base] of rest) {
      const bone = bones.get(name); bone.position.copy(base.position); bone.quaternion.copy(base.quaternion);
    }
    if (stance !== 'standing') for (const track of poses[stance].clip.tracks) {
      const [, name, property] = track.name.match(/\.bones\[([^\]]+)\]\.(quaternion|position)/);
      bones.get(name)[property].fromArray(track.values);
    }
    root.updateMatrixWorld(true);
  } };
}

function fixture(kind, heading = .7, yaw = 0, pitch = 0) {
  if (kind === 'type89') {
    const model = createGrenadeDischargerModel();
    model.rotation.y = heading; model.position.set(4, 1.1, -6);
    const local = model.userData.supportWeapon.operator;
    const operator = model.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
    return { model, operator, heading };
  }
  const point = createEmplacement({ id: 'test', profile: kind, x: 4, z: -6, heading, altitude: 1.1 });
  emplacementLook(point, heading + yaw, pitch);
  const model = createEmplacementModel(point); model.position.y = 1.1; model.userData.update();
  const pose = emplacementPose(point, 1.1);
  return { model, operator: new THREE.Vector3(pose.operator.x, pose.operator.y, pose.operator.z),
    heading: point.yaw, point };
}

test('four shared canonical banks match real model anchors with both native 65-bone rigs', () => {
  for (const team of ['friendly', 'enemy']) {
    const native = rig(team);
    for (const bank of SUPPORT_WEAPON_BANKS) {
      const { root, bones } = native, setup = fixture(bank.kind);
      native.apply(bank.firingPose ?? 'standing');
      root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
      const pose = createSupportWeaponPose(root, bones), actor = { id: 'operator', team, health: 100,
        supportWeaponPose: { ...bank, active: true } };
      const before = new Map([...bones].map(([name, bone]) => [name, [bone.position.toArray(), bone.scale.toArray()]]));
      const snapshot = pose.update(actor, 1, setup.model);
      assert.equal(snapshot.contactLimited, false, `${team} ${bank.kind}: ${JSON.stringify(snapshot)}`);
      for (const [side, hand] of Object.entries(snapshot.hands)) {
        assert.ok(hand.wristError < .04); assert.ok(hand.palmError < .008);
        assert.ok(hand.distance < hand.maximumReach);
      }
      for (const [name, bone] of bones) {
        assert.deepEqual(bone.position.toArray(), before.get(name)[0]);
        assert.deepEqual(bone.scale.toArray(), before.get(name)[1]);
      }
      pose.reset();
    }
  }
});

test('third-person machine-gun fingers wrap the actual handles', () => {
  for (const team of ['friendly', 'enemy']) {
    const native = rig(team), { root, bones } = native;
    const pose = createSupportWeaponPose(root, bones);
    for (const kind of ['maxim24', 'maxim24aa']) for (const [yaw, pitch] of [
      [EMPLACEMENT_PROFILES[kind].traverse, EMPLACEMENT_PROFILES[kind].maxPitch],
      [0, 0], [.35, .2], [-.35, .1], [0, .5],
      [-EMPLACEMENT_PROFILES[kind].traverse, EMPLACEMENT_PROFILES[kind].minPitch],
    ]) {
      const bank = SUPPORT_WEAPON_BANKS.find(value => value.kind === kind), setup = fixture(kind, .7, yaw, pitch);
      native.apply(bank.firingPose ?? 'standing');
      root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
      pose.update({ id: 'gunner', team, health: 100, supportWeaponPose: { ...bank, active: true } }, 1, setup.model);
      const targets = supportWeaponTargets(setup.model, root);
      for (const side of ['left', 'right']) {
        const target = targets[side], center = new THREE.Vector3(...target.center), axis = new THREE.Vector3(...target.axis).normalize();
        const prefix = side === 'left' ? 'Left' : 'Right';
        const wrist = bones.get(`${prefix}Hand`).getWorldPosition(new THREE.Vector3());
        const elbow = bones.get(`${prefix}ForeArm`).getWorldPosition(new THREE.Vector3());
        const knuckle = bones.get(`${prefix}HandMiddle1`).getWorldPosition(new THREE.Vector3());
        const bend = wrist.clone().sub(elbow).angleTo(knuckle.sub(wrist));
        if (Math.abs(yaw) <= .35 && pitch >= 0 && (pitch <= .2 || pitch === .5))
          assert.ok(bend < Math.PI / 6, `${team} ${kind} yaw=${yaw} pitch=${pitch} ${side} wrist bend ${THREE.MathUtils.radToDeg(bend)}`);
        const axialTips = {};
        for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
          const points = [1, 2, 3, 4].map(joint => root.worldToLocal(
            bones.get(`${prefix}Hand${finger}${joint}`).getWorldPosition(new THREE.Vector3())));
          const point = points[3].clone();
          const delta = point.sub(center), axial = delta.dot(axis), radial = delta.addScaledVector(axis, -axial).length();
          axialTips[finger] = axial;
          assert.ok(Math.abs(axial) <= .09 && radial >= target.radius - .008 && radial <= target.radius + .012,
            `${team} ${kind} ${yaw} ${pitch} ${side} ${finger}: axial=${axial} radial=${radial}`);
          for (let index = 0; index < 3; index++) for (const fraction of [0, .25, .5, .75, 1]) {
            const sample = points[index].clone().lerp(points[index + 1], fraction).sub(center);
            const along = sample.dot(axis), distance = sample.addScaledVector(axis, -along).length();
            if (Math.abs(along) <= .08) assert.ok(distance >= target.radius - .006,
              `${team} ${kind} ${side} ${finger} segment ${index} intersects the handle: ${distance}`);
          }
        }
        assert.ok(axialTips.Index > axialTips.Pinky && axialTips.Thumb > axialTips.Pinky,
          `${team} ${kind} ${side} thumb-index web must face up`);
      }
      pose.reset();
    }
  }
});

test('dynamic controls follow actual constrained traverse/pitch and stay reachable rather than using neutral empty hands', () => {
  const native = rig('friendly'), { root, bones } = native;
  for (const bank of SUPPORT_WEAPON_BANKS.filter(bank => bank.kind !== 'type89')) {
    const profile = EMPLACEMENT_PROFILES[bank.kind];
    for (const yaw of [-profile.traverse, 0, profile.traverse]) for (const pitch of [profile.minPitch, profile.maxPitch]) {
      const setup = fixture(bank.kind, .7, yaw, pitch);
      native.apply(bank.firingPose ?? 'standing');
      root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
      const pose = createSupportWeaponPose(root, bones);
      const snapshot = pose.update({ id: 'fixed', health: 100, supportWeaponPose: { ...bank, active: true } }, 1, setup.model);
      assert.equal(snapshot.contactLimited, false, `${bank.kind} yaw=${yaw} pitch=${pitch}: ${JSON.stringify(snapshot)}`);
      for (const [side, hand] of Object.entries(snapshot.hands)) {
        const shoulder = root.localToWorld(new THREE.Vector3(...hand.shoulder));
        const elbow = root.localToWorld(new THREE.Vector3(...hand.elbow));
        const wrist = root.localToWorld(new THREE.Vector3(...hand.wrist));
        for (const [from, to, margin] of [[shoulder, elbow, .025], [elbow, wrist, .11]]) {
          const delta = to.clone().sub(from);
          const ray = new THREE.Raycaster(from, delta.clone().normalize(), .01, Math.max(.01, delta.length() - margin));
          const hits = ray.intersectObject(setup.model, true);
          assert.equal(hits.length, 0,
            `${bank.kind} ${side} yaw=${yaw} pitch=${pitch} arm collision ${JSON.stringify(hits[0]?.point)}`);
        }
      }
      assert.equal(circleBlocked(setup.operator.x, setup.operator.z, .43,
        emplacementObstacles(setup.point), setup.operator.y), false, `${bank.kind} yaw=${yaw} pitch=${pitch} operator blocked`);
      pose.reset();
    }
  }
});

test('authored palm anchors are on actual tube, handles and control geometry including their native finger-pad allowance', () => {
  for (const bank of SUPPORT_WEAPON_BANKS) {
    const setup = fixture(bank.kind);
    setup.model.updateMatrixWorld(true);
    const anchors = Object.values(setup.model.userData.supportWeapon.grips);
    if (setup.model.userData.supportWeapon.loading) anchors.push(...Object.values(setup.model.userData.supportWeapon.loading));
    for (const anchor of anchors) {
      const palm = anchor.palm.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(...anchor.normal).transformDirection(anchor.grip.matrixWorld);
      const ray = new THREE.Raycaster(palm.clone().addScaledVector(normal, .05), normal.clone().negate(), 0, .1);
      const hit = ray.intersectObject(setup.model, true)[0];
      assert.ok(hit && hit.point.distanceTo(palm) < .015, `${bank.kind} ${anchor.palm.name} must touch authored geometry`);
    }
  }
});

test('Type89 operating gaze stays raised toward the target while both native hands retain real contacts', () => {
  for (const team of ['friendly', 'enemy']) {
    const native = rig(team), { root, bones } = native;
    const head = bones.get('Head'), neck = bones.get('Neck');
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).invert());
    native.profile.headAim = { forward: forward.toArray() };
    for (const heading of [0, 1.3, Math.PI]) for (const pitch of [-.2, 0, .25]) {
      const setup = fixture('type89', heading);
      native.apply('kneeling'); root.position.copy(setup.operator); root.rotation.y = heading; root.updateMatrixWorld(true);
      const base = { head: head.quaternion.clone(), neck: neck.quaternion.clone() };
      const pose = createSupportWeaponPose(root, bones);
      const actor = { id: 'raised-tube-operator', health: 100, nativeMotion: { profile: native.profile },
        supportWeaponPose: { active: true, kind: 'type89', phase: 'operate', gazePitch: pitch } };
      const result = pose.update(actor, 1, setup.model);
      assert.equal(result.contactLimited, false, JSON.stringify(result));
      assert.ok(result.gaze.error < 1e-6);
      assert.ok(Math.abs(result.gaze.direction[1] - Math.sin(pitch)) < 1e-6);
      for (const hand of Object.values(result.hands)) {
        assert.ok(hand.wristError < .04); assert.ok(hand.palmError < .008);
      }
      actor.supportWeaponPose.phase = 'loading';
      const loading = pose.update(actor, 2, setup.model);
      assert.equal(loading.gaze, null);
      const loadingForward = forward.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(loadingForward.y < -.2, 'looking down is retained only for handling the next round');
      pose.reset();
      assert.deepEqual(head.quaternion.toArray(), base.head.toArray());
      assert.deepEqual(neck.quaternion.toArray(), base.neck.toArray());
    }
  }
});

test('Type89 loading hand touches its rim, brace remains held and actor-local targets match transformed model targets', () => {
  const native = rig('enemy'), { root, bones } = native, setup = fixture('type89', 2.1);
  native.apply('kneeling'); root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
  const pose = createSupportWeaponPose(root, bones), actor = { id: 'tube', health: 100,
    supportWeaponPose: { active: true, kind: 'type89', phase: 'loading' } };
  const snapshot = pose.update(actor, 1, setup.model);
  assert.equal(snapshot.contactLimited, false, JSON.stringify(snapshot));
  const target = supportWeaponTargets(setup.model, root, 'loading');
  pose.reset(); actor.supportWeaponPose.targets = target;
  const local = pose.update(actor, 1);
  for (const side of ['left', 'right']) {
    assert.ok(new THREE.Vector3(...local.hands[side].wrist).distanceTo(new THREE.Vector3(...snapshot.hands[side].wrist)) < 1e-6);
  }
});

test('field-gun reload phase keeps traverse held and moves the right native hand to the real breech lever', () => {
  const native = rig('friendly'), { root, bones } = native;
  const view = createSupportViewHands(side => createNraGrenadeHand(native.normalized, side, { fullArm: true, weaponRig: true }));
  const camera = new THREE.PerspectiveCamera();
  for (const pitch of [-.12, 0, .55]) {
    const setup = fixture('bofors75', .7, .85, pitch);
    native.apply('kneeling'); root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
    const pose = createSupportWeaponPose(root, bones), actor = { id: 'gunner', team: 'friendly', health: 100,
      position: setup.operator, heading: setup.heading, nativeMotion: { profile: native.profile },
      supportWeaponPose: { active: true, kind: 'bofors75', phase: 'loading' } };
    const snapshot = pose.update(actor, 1, setup.model);
    assert.equal(snapshot.contactLimited, false, `breech pitch=${pitch}: ${JSON.stringify(snapshot)}`);
    assert.notDeepEqual(supportWeaponTargets(setup.model, root, 'loading').right.wrist,
      supportWeaponTargets(setup.model, root, 'operate').right.wrist);
    assert.equal(view.update(actor, camera, setup.model).contactLimited, false, `first-person breech pitch=${pitch}`);
    pose.reset();
  }
});

test('artillery marching retains standing native arms while the gunner mode is kneeling', () => {
  const native = rig('friendly'), setup = fixture('bofors75');
  setup.point.position = 'march'; setup.model.userData.update();
  native.apply('standing');
  native.root.position.copy(setup.operator); native.root.rotation.y = setup.heading; native.root.updateMatrixWorld(true);
  const actor = { id: 'marching-gunner', team: 'friendly', health: 100, position: setup.operator,
    heading: setup.heading, nativeMotion: { profile: native.profile },
    supportWeaponPose: { active: true, kind: 'bofors75', phase: 'march' } };
  const pose = createSupportWeaponPose(native.root, native.bones);
  assert.equal(pose.update(actor, 1, setup.model).contactLimited, false);
  const view = createSupportViewHands(side => createNraGrenadeHand(native.normalized, side, { fullArm: true, weaponRig: true }));
  assert.equal(view.update(actor, new THREE.PerspectiveCamera(), setup.model).contactLimited, false);
  assert.equal(setup.model.userData.supportWeapon.stance, 'standing');
});

test('stow, ordinary roles, shield, death and pooled rebinding restore owned arm/finger rotations only', () => {
  const native = rig('enemy'), { root, bones } = native, setup = fixture('type89');
  native.apply('kneeling'); root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
  const pose = createSupportWeaponPose(root, bones), actor = { id: 'tube', health: 100,
    supportWeaponPose: { active: true, kind: 'type89', phase: 'operate' } };
  const before = [...bones].map(([name, bone]) => [name, bone.quaternion.toArray()]);
  pose.update(actor, 1, setup.model);
  pose.update({ id: 'ordinary', health: 100 }, 2);
  assert.deepEqual([...bones].map(([name, bone]) => [name, bone.quaternion.toArray()]), before);
  for (const person of [{ ...actor, health: 0 }, { ...actor, casualty: {} },
    { ...actor, sihangShield: { active: true } }, { ...actor, supportWeaponPose: { ...actor.supportWeaponPose, active: false } }])
    assert.equal(supportWeaponPoseIndex(person), -1);
  pose.update(actor, 3, setup.model);
  bones.get('LeftHand').quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), .3);
  const external = bones.get('LeftHand').quaternion.clone();
  pose.reset();
  assert.deepEqual(bones.get('LeftHand').quaternion.toArray(), external.toArray(), 'a later casualty/ordinary solver owns its pose');
  actor.id = 'rebound'; pose.update(actor, 4, setup.model);
  assert.equal(pose.snapshot.owner, 'rebound');
});

test('unreachable targets report actual residual error and fixed reach without scaling or fake wrist contact', () => {
  const native = rig('enemy'), { root, bones } = native;
  for (const kind of ['type89', 'maxim24']) {
    const setup = fixture(kind);
    native.apply('kneeling'); root.position.copy(setup.operator); root.rotation.y = setup.heading; root.updateMatrixWorld(true);
    const targets = supportWeaponTargets(setup.model, root);
    targets.left.wrist = [-3, 7, 0]; targets.left.palm = [-3, 7, -.055];
    const pose = createSupportWeaponPose(root, bones);
    const snapshot = pose.update({ id: 'unreachable', health: 100,
      supportWeaponPose: { active: true, kind, phase: 'operate', targets } }, 1);
    assert.equal(snapshot.contactLimited, true); assert.ok(snapshot.hands.left.solveError > 5);
    assert.ok(pose.issue); assert.equal(bones.get('LeftArm').scale.x, 1);
    pose.reset();
  }
});

test('first-person uses two native sleeve/hand skins with real contacts, shared posture origins and no camera head or rifle', () => {
  const native = rig('friendly'), { root, bones } = native;
  const view = createSupportViewHands(side => createNraGrenadeHand(native.normalized, side, { fullArm: true, weaponRig: true }));
  const camera = new THREE.PerspectiveCamera();
  for (const bank of SUPPORT_WEAPON_BANKS) {
    const profile = EMPLACEMENT_PROFILES[bank.kind];
    for (const pitch of profile ? [profile.minPitch, profile.maxPitch] : [0]) {
      const setup = fixture(bank.kind, .7, profile ? profile.traverse : 0, pitch);
      native.apply(bank.firingPose ?? 'standing'); root.position.copy(setup.operator); root.rotation.y = setup.heading;
      root.updateMatrixWorld(true);
      const actor = { id: 'controlled', team: 'friendly', position: setup.operator, heading: setup.heading, health: 100,
        nativeMotion: { profile: native.profile }, supportWeaponPose: { ...bank, active: true } };
      const posed = createSupportWeaponPose(root, bones);
      const body = posed.update(actor, 1, setup.model);
      const snapshot = view.update(actor, camera, setup.model, { nativePose: body });
      assert.equal(snapshot.contactLimited, false, `${bank.kind} ${pitch}: ${JSON.stringify(snapshot)}`);
      assert.equal(view.root.visible, true);
      for (const hand of Object.values(snapshot.hands)) {
        assert.ok(hand.palmError < .008); assert.ok(hand.wristError < .04);
        assert.ok(hand.reachable); assert.ok(hand.source.includes('native') || hand.source.includes('authorized'));
      }
      posed.reset();
      const automatic = view.update(actor, camera, setup.model);
      assert.equal(automatic.contactLimited, false, `profile-only ${bank.kind} ${pitch}: ${JSON.stringify(automatic)}`);
      const visible = [];
      view.root.traverseVisible(node => { if (node.isMesh) visible.push(node); });
      assert.ok(visible.length >= 4);
      assert.ok(visible.every(mesh => ['手部', '衣服', '臂章'].includes(mesh.name)));
      assert.equal(view.root.getObjectByName('owned-muzzle'), undefined);
    }
  }
});

test('first-person stow/death/role/rebind is explicit, and repeated aiming never clones geometry or material', () => {
  const native = rig('friendly'), setup = fixture('maxim24');
  let creations = 0, appearances = 0;
  const view = createSupportViewHands(side => {
    creations++; return createNraGrenadeHand(native.normalized, side, { fullArm: true, weaponRig: true });
  }, { applyAppearance: () => { appearances++; } });
  const camera = new THREE.PerspectiveCamera(), actor = { id: 'first', team: 'friendly', health: 100,
    position: setup.operator, heading: setup.heading, nativeMotion: { profile: native.profile },
    supportWeaponPose: { active: true, kind: 'maxim24', phase: 'operate' } };
  const resources = () => {
    const rows = []; view.root.traverse(node => { if (node.isMesh) rows.push([node.geometry, node.material]); });
    return rows;
  };
  const before = resources();
  for (let i = 0; i < 50; i++) view.update(actor, camera, setup.model);
  assert.deepEqual(resources(), before); assert.equal(creations, 2); assert.equal(appearances, 1);
  for (const person of [{ ...actor, health: 0 }, { ...actor, team: 'enemy' }, { ...actor, supportWeaponPose: null }]) {
    assert.equal(view.update(person, camera, setup.model), null); assert.equal(view.root.visible, false);
  }
  actor.id = 'second'; view.update(actor, camera, setup.model);
  assert.equal(view.snapshot.owner, 'second'); assert.equal(appearances, 2);
  const snapshot = view.update(actor, camera, setup.model, { shoulders: { left: [-5, 5, 0], right: [5, 5, 0] } });
  assert.equal(snapshot.contactLimited, true); assert.equal(view.root.visible, false); assert.ok(view.issue);
  view.reset(); assert.equal(view.snapshot, null); assert.equal(view.root.visible, false);
  assert.ok(view.resources.geometries > 0); assert.ok(view.resources.materials > 0);
  view.dispose();
  assert.equal(view.root.children.length, 0); assert.equal(view.resources.geometries, 0); assert.equal(view.resources.materials, 0);
});

test('first-person Maxim fingers wrap the real handle at multiple aim angles', () => {
  const native = rig('friendly');
  const view = createSupportViewHands(side => createNraGrenadeHand(native.normalized, side, { fullArm: true, weaponRig: true }));
  const camera = new THREE.PerspectiveCamera();
  for (const kind of ['maxim24', 'maxim24aa']) for (const [yaw, pitch] of [[0, 0], [.35, .3], [-.35, .1]]) {
    const setup = fixture(kind, .7, yaw, pitch);
    const actor = { id: 'gunner', team: 'friendly', health: 100, position: setup.operator,
      heading: setup.heading, nativeMotion: { profile: native.profile },
      supportWeaponPose: { active: true, kind, phase: 'operate' } };
    const snapshot = view.update(actor, camera, setup.model);
    assert.equal(snapshot.contactLimited, false);
    const targets = supportWeaponTargets(setup.model, view.root);
    for (const side of ['left', 'right']) {
      const target = targets[side], center = new THREE.Vector3(...target.center);
      const axis = new THREE.Vector3(...target.axis).normalize(), hand = view.root.getObjectByName(`${side}-grenade-hand`);
      const joints = {}, bases = {};
      const prefix = side === 'left' ? 'Left' : 'Right';
      const wrist = hand.getObjectByName(`${prefix}Hand`).getWorldPosition(new THREE.Vector3());
      const elbow = hand.getObjectByName(`${prefix}ForeArm`).getWorldPosition(new THREE.Vector3());
      const knuckle = hand.getObjectByName(`${prefix}HandMiddle1`).getWorldPosition(new THREE.Vector3());
      const bend = wrist.clone().sub(elbow).normalize().angleTo(knuckle.sub(wrist).normalize());
      assert.ok(bend < Math.PI / 6, `${kind} ${side} wrist bend ${THREE.MathUtils.radToDeg(bend)} degrees`);
      for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
        const points = [1, 2, 3, 4].map(index => view.root.worldToLocal(
          hand.getObjectByName(`${prefix}Hand${finger}${index}`).getWorldPosition(new THREE.Vector3())));
        bases[finger] = points[0].clone().sub(center).dot(axis);
        const tip = points[3].clone();
        const delta = tip.sub(center), axial = delta.dot(axis);
        if (finger !== 'Thumb') assert.ok(delta.clone().addScaledVector(axis, -axial).z > 0,
          `${kind} ${side} ${finger} must face the player`);
        joints[finger] = axial;
        const radius = delta.addScaledVector(axis, -axial).length();
        assert.ok(Math.abs(axial) <= .09, `${kind} ${side} ${finger} outside handle: ${axial}`);
        assert.ok(radius >= target.radius - .008 && radius <= target.radius + .012,
          `${kind} ${side} ${finger} radial distance ${radius}, handle ${target.radius}`);
        for (let index = 0; index < 3; index++) for (const fraction of [0, .25, .5, .75, 1]) {
          const point = points[index].clone().lerp(points[index + 1], fraction).sub(center);
          const along = point.dot(axis), radial = point.addScaledVector(axis, -along).length();
          if (Math.abs(along) <= .08) assert.ok(radial >= target.radius - .006,
            `${kind} ${side} ${finger} segment ${index} intersects handle: ${radial}`);
        }
      }
      assert.ok(joints.Index > joints.Pinky && joints.Thumb > joints.Pinky,
        `${kind} ${side} thumb-index web must face up along the handle`);
      assert.ok(bases.Index > bases.Pinky && bases.Thumb > bases.Pinky,
        `${kind} ${side} thumb and index roots must be above the little finger`);
    }
  }
  view.dispose();
});
