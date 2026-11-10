import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSihangShieldPose, SIHANG_SHIELD_POSES, sihangShieldPoseIndex, createSihangSatchel,
  sihangShieldInstalling, sihangShieldWalkWeights } from '../src/sihang-shield-pose.js';
import { createNraRiflePose } from '../src/nra-rifle-pose.js';
import { createNativeGaitProfile } from '../src/nra-gait.js';
import { createNraMotion, sampleNraMotion, syncNativeAimGoal, nativeGaitDrop } from '../src/nra-motion.js';
import { createNraForceRendererAsync } from '../src/nra-force-renderer.js';
import { createRifleState } from '../src/rifle-action.js';
import { rifleWorldModel } from '../src/rifle-model.js';
import { createCasualtyPose, createCasualtyState } from '../src/casualties.js';
import { loadIjaCharacter } from '../src/ija-character.js';
import { RIFLE_HAND_SAMPLES } from '../src/rifle-hand-action.js';

async function nativeRig() {
  const binary = await readFile(new URL('../public/assets/game/ija-1938/character.glb', import.meta.url));
  const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
  const joints = new Set(gltf.skins[0].joints), bones = new Map();
  const nodes = gltf.nodes.map((node, index) => {
    const object = joints.has(index) ? new THREE.Bone() : new THREE.Group();
    object.name = node.name;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    if (joints.has(index)) bones.set(node.name, object);
    return object;
  });
  gltf.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
  const avatar = new THREE.Group(), root = new THREE.Group();
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) avatar.add(nodes[index]);
  avatar.rotation.y = Math.PI; root.add(avatar); root.updateMatrixWorld(true);
  assert.equal(bones.size, 65);
  return { root, bones };
}

const actor = shield => ({ team: 'enemy', health: 100, sihangShield: shield });
const transforms = bones => [...bones].map(([name, bone]) =>
  [name, bone.position.toArray(), bone.quaternion.toArray(), bone.scale.toArray()]);
const wrist = bones => bones.get('LeftHand').getWorldPosition(new THREE.Vector3());

test('only valid, living members of the 20-man enemy squad receive shield poses; ordinary rigs are untouched', async () => {
  const { root, bones } = await nativeRig(), carry = createSihangShieldPose(root, bones);
  const before = transforms(bones);
  for (let slot = 0; slot < 20; slot++)
    assert.equal(sihangShieldPoseIndex(actor({ ...SIHANG_SHIELD_POSES[0], slot })), 0);
  for (const person of [{ team: 'enemy', health: 100 }, actor(null), actor({ ...SIHANG_SHIELD_POSES[0], active: false }),
    actor({ ...SIHANG_SHIELD_POSES[0], slot: 20 }), actor({ ...SIHANG_SHIELD_POSES[0], slot: -1 }),
    actor({ ...SIHANG_SHIELD_POSES[0], slot: 1.5 }), actor({ ...SIHANG_SHIELD_POSES[0], mode: 'other' }),
    actor({ ...SIHANG_SHIELD_POSES[0], handTarget: [NaN, 1, 0] }),
    { ...actor(SIHANG_SHIELD_POSES[0]), team: 'friendly' },
    { ...actor(SIHANG_SHIELD_POSES[0]), health: 0 },
    { ...actor(SIHANG_SHIELD_POSES[0]), casualty: {} }]) {
    assert.equal(sihangShieldPoseIndex(person), -1);
    assert.equal(carry.update(person, 1), null);
    assert.deepEqual(transforms(bones), before);
  }
});

for (const shield of SIHANG_SHIELD_POSES) test(`native ${shield.mode} wrist reaches actor-local target with rigid anatomical arm lengths`, async () => {
  const { root, bones } = await nativeRig();
  root.position.set(17, 2.3, -9); root.rotation.y = 1.23; root.updateMatrixWorld(true);
  const carry = createSihangShieldPose(root, bones), before = transforms(bones);
  const upper = bones.get('LeftArm'), lower = bones.get('LeftForeArm');
  const a = upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3()));
  const b = lower.getWorldPosition(new THREE.Vector3()).distanceTo(wrist(bones));
  const state = carry.update(actor(shield), 0);
  assert.equal(state.reachable, true, JSON.stringify(state));
  assert.ok(state.error < .008, JSON.stringify(state));
  assert.ok(wrist(bones).distanceTo(root.localToWorld(new THREE.Vector3(...shield.handTarget))) < .008);
  assert.ok(state.hands.right.palmError < .008);
  assert.ok(Math.abs(state.upperLength - a) < 1e-7);
  assert.ok(Math.abs(state.lowerLength - b) < 1e-7);
  const after = transforms(bones);
  for (let index = 0; index < before.length; index++) {
    assert.deepEqual(after[index][1], before[index][1], 'no bone translations');
    assert.deepEqual(after[index][3], before[index][3], 'no bone scaling');
    if (!/^(Left|Right|Spine$)/.test(before[index][0]))
      assert.deepEqual(after[index], before[index], 'unrelated head and lower-body joints remain unchanged');
  }
});

test('hands follow the actual moving shield without additional lag, reset on rebinding, and never stretch', async () => {
  const { root, bones } = await nativeRig(), carry = createSihangShieldPose(root, bones);
  carry.update(actor(SIHANG_SHIELD_POSES[0]), 0);
  root.position.set(4, 1, -8); root.rotation.y = 2;
  const state = carry.update(actor(SIHANG_SHIELD_POSES[1]), 1 / 60);
  assert.deepEqual(state.localTarget, SIHANG_SHIELD_POSES[1].handTarget);
  assert.ok(wrist(bones).distanceTo(root.localToWorld(new THREE.Vector3(...state.localTarget))) < .008);
  carry.reset();
  assert.deepEqual(carry.update(actor(SIHANG_SHIELD_POSES[1]), 1).localTarget, SIHANG_SHIELD_POSES[1].handTarget);
  const unreachable = carry.update(actor({ ...SIHANG_SHIELD_POSES[0], handTarget: [-3, 10, 0] }), 1);
  assert.equal(unreachable.reachable, false);
  assert.ok(unreachable.error > 5);
  assert.ok(Math.abs(unreachable.upperLength - state.upperLength) < 1e-7);
  assert.ok(Math.abs(unreachable.lowerLength - state.lowerLength) < 1e-7);
});

test('heavy shield overrides both arms without moving the stowed gun and leaves native casualties untouched', async () => {
  const { root, bones } = await nativeRig();
  const gun = rifleWorldModel('far', null, { bayonet: true }), riflePose = createNraRiflePose(root, bones, gun);
  const carry = createSihangShieldPose(root, bones);
  const source = JSON.parse(await readFile(new URL('../public/assets/game/ija-1938/source.json', import.meta.url)));
  const profile = createNativeGaitProfile(source.motion.idle, bones.get('RightArm').getWorldPosition(new THREE.Vector3()).toArray());
  const person = { ...actor(SIHANG_SHIELD_POSES[0]), id: 'shield', position: new THREE.Vector3(), heading: 0,
    walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
  person.nativeMotion = createNraMotion(profile, person);
  syncNativeAimGoal(person);
  riflePose.update(sampleNraMotion(person));
  const right = bones.get('RightHand').matrixWorld.clone(), weapon = gun.matrixWorld.clone();
  const state = carry.update(person, 0);
  assert.ok(state.error < .008);
  assert.notDeepEqual(bones.get('RightHand').matrixWorld, right);
  assert.ok(state.hands.right.palmError < .008);
  assert.deepEqual(gun.matrixWorld, weapon);
  person.health = 0; person.casualty = createCasualtyState(person, 1, sampleNraMotion(person), { variant: 0, retainGun: true });
  const casualty = createCasualtyPose(root, bones, gun, () => 0);
  casualty(person, 3);
  const corpse = transforms(bones);
  assert.equal(carry.update(person, 3), null);
  assert.deepEqual(transforms(bones), corpse);
});

async function loadNativeTemplate() {
  const binary = await readFile(new URL('../public/assets/game/ija-1938/character.glb', import.meta.url));
  const source = await readFile(new URL('../public/assets/game/ija-1938/source.json', import.meta.url), 'utf8');
  const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
  // Keep the production skin, 65-bone hierarchy and clips; headless Node does not decode clothing textures.
  const mappedMaterials = new Set(gltf.materials.flatMap((material, index) => material.pbrMetallicRoughness?.baseColorTexture ? [index] : []));
  gltf.materials = gltf.materials.map(({ name }) => ({ name }));
  delete gltf.textures; delete gltf.images; delete gltf.extensionsUsed; delete gltf.extensionsRequired;
  const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const payload = binary.subarray(20 + binary.readUInt32LE(12)), packed = Buffer.alloc(20 + padded.length + payload.length);
  packed.writeUInt32LE(0x46546c67, 0); packed.writeUInt32LE(2, 4); packed.writeUInt32LE(packed.length, 8);
  packed.writeUInt32LE(padded.length, 12); packed.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(packed, 20); payload.copy(packed, 20 + padded.length);
  const fetch = globalThis.fetch, load = GLTFLoader.prototype.loadAsync;
  globalThis.fetch = async () => new Response(source);
  GLTFLoader.prototype.loadAsync = async function () {
    const asset = await this.parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), '');
    asset.scene.traverse(mesh => {
      if (mesh.material && mappedMaterials.has(asset.parser.associations.get(mesh.material)?.materials)) mesh.material.map = new THREE.Texture();
    });
    return asset;
  };
  try { return await loadIjaCharacter(() => 0); }
  finally {
    globalThis.fetch = fetch; GLTFLoader.prototype.loadAsync = load;
  }
}

test('production IJA near/far views apply carry after native idle/rifle updates and clear it for normal actors and casualties', async () => {
  const template = await loadNativeTemplate();
  const person = { ...actor(SIHANG_SHIELD_POSES[0]), id: 'native-shield', unitId: 'demolition', position: new THREE.Vector3(2, 0, -6),
    heading: .6, walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
  person.nativeMotion = createNraMotion(template.motionProfile, person);
  for (const view of [template, template.createFarView()]) {
    view.bind(person.id);
    for (const mode of SIHANG_SHIELD_POSES) {
      person.sihangShield = mode;
      view.update(person, 1, null);
      assert.equal(view.issue, null, JSON.stringify(view.snapshot.shieldCarry));
      assert.equal(view.snapshot.shieldCarry.mode, mode.mode);
      assert.ok(view.snapshot.shieldCarry.error < .008);
      assert.equal(view.root.getObjectByName('Hips').parent !== null, true);
      const feet = [];
      for (const phase of [.25, .75]) {
        person.nativeMotion.weight = 1; person.nativeMotion.speed = 1.75;
        person.nativeMotion.gaitCycles = phase; person.nativeMotion.phaseDistance = person.nativeMotion.distance;
        person.sihangShield = { ...mode, handTarget: [mode.handTarget[0],
          mode.handTarget[1] - nativeGaitDrop(person), mode.handTarget[2]] };
        syncNativeAimGoal(person);
        view.update(person, 1, null);
        assert.equal(view.issue, null, JSON.stringify(view.snapshot.shieldCarry));
        assert.ok(view.snapshot.shieldCarry.error < .008);
        feet.push(new THREE.Vector3(...view.snapshot.leftFoot));
      }
      assert.ok(feet[0].distanceTo(feet[1]) > .03, 'production native feet alternate while holding the shield');
      person.nativeMotion.weight = 0; person.nativeMotion.speed = 0; syncNativeAimGoal(person);
      person.sihangShield = mode;
    }
    person.sihangShield = { ...SIHANG_SHIELD_POSES[0], installing: true };
    const weaponState = JSON.stringify(person.rifle);
    view.update(person, 1, null);
    assert.ok(view.snapshot.shieldCarry.installation.error < .008);
    assert.equal(view.root.children.find(child => child.userData.personalWeapon).visible, false);
    assert.equal(view.root.getObjectByName('sihang-demolition-satchel').visible, true);
    assert.equal(JSON.stringify(person.rifle), weaponState);
    delete person.sihangShield;
    view.update(person, 2, null);
    assert.equal(view.snapshot.shieldCarry, undefined);
    assert.equal(view.root.children.find(child => child.userData.personalWeapon).visible, true);
    assert.equal(view.root.getObjectByName('sihang-demolition-satchel').visible, false);
    person.sihangShield = SIHANG_SHIELD_POSES[0]; person.health = 0;
    person.casualty = createCasualtyState(person, 2, sampleNraMotion(person), { variant: 0, retainGun: true });
    view.update(person, 4, null);
    assert.equal(view.snapshot.shieldCarry, undefined);
    assert.ok(view.snapshot.casualty);
    person.formation = { sihangDemolition: true, memberCount: 20 };
    view.update(person, 4, null);
    assert.equal(view.root.children.find(child => child.userData.personalWeapon).visible, false,
      'an unarmed sapper corpse cannot regain the pose-only rifle through casualty retention');
    delete person.formation;
    person.health = 100; delete person.casualty;
  }
});

test('same native view restores ordinary clavicle, fingers and right rifle posing after carry, pooled rebinding and casualty transitions', async () => {
  const template = await loadNativeTemplate();
  const skeleton = view => {
    let mesh = null;
    view.root.traverseVisible(node => { if (!mesh && node.isSkinnedMesh) mesh = node; });
    return mesh.skeleton.bones;
  };
  const poseState = view => ({
    joints: skeleton(view).map(bone => ({
      name: bone.name, position: bone.position.toArray(), rotation: bone.quaternion.toArray(),
      scale: bone.scale.toArray(), world: bone.matrixWorld.toArray(),
    })),
    rifle: view.snapshot.riflePose,
    weapon: view.root.children.find(child => child.userData.personalWeapon).matrixWorld.toArray(),
    weaponVisible: view.root.children.find(child => child.userData.personalWeapon).visible,
  });
  for (const level of ['near', 'far']) {
    const create = () => level === 'near' ? template.createView() : template.createFarView();
    const view = create();
    const person = { team: 'enemy', health: 100, id: `reuse-${level}`, unitId: 'demolition',
      position: new THREE.Vector3(2, 0, -6), heading: .6, walkPhase: 0,
      locomotion: { speed: 0 }, rifle: createRifleState() };
    person.nativeMotion = createNraMotion(template.motionProfile, person);
    view.bind(person.id);
    view.update(person, 0, null);
    const ordinary = poseState(view);
    const compareClean = (now, operation = undefined) => {
      const reference = create();
      reference.bind(person.id); reference.update(person, now, null, operation);
      assert.equal(view.issue, reference.issue);
      assert.deepEqual(poseState(view), poseState(reference),
        `${level}: all 65 joints, fingers, right-hand rifle contacts and owned weapon match a never-carried rig`);
      assert.equal(view.snapshot.shieldCarry, undefined);
      assert.equal(view.root.getObjectByName('sihang-demolition-satchel').visible, false);
      return reference;
    };
    for (const mode of SIHANG_SHIELD_POSES) {
      person.sihangShield = { ...mode, installing: true };
      view.update(person, 1, null);
      assert.ok(view.snapshot.shieldCarry);
      assert.notDeepEqual(
        poseState(view).joints.find(joint => joint.name === 'LeftArm').rotation,
        ordinary.joints.find(joint => joint.name === 'LeftArm').rotation,
        'the test starts from a real two-handed support pose');
      assert.notDeepEqual(poseState(view).joints.find(joint => joint.name === 'LeftHandIndex1').rotation,
        ordinary.joints.find(joint => joint.name === 'LeftHandIndex1').rotation, 'carrying changes the rifle-support fingers');
      assert.notDeepEqual(poseState(view).joints.find(joint => joint.name === 'RightArm').rotation,
        ordinary.joints.find(joint => joint.name === 'RightArm').rotation, 'planting really overrides the right rifle arm');
      if (mode.mode === 'roof') delete person.sihangShield;
      else person.sihangShield = { ...mode, active: false };
      view.update(person, 2, null);
      compareClean(2);
      delete person.sihangShield;
    }
    person.sihangShield = { ...SIHANG_SHIELD_POSES[0], installing: true };
    view.update(person, 3, null);
    delete person.sihangShield;
    person.id = `ordinary-replacement-${level}`;
    person.nativeMotion = createNraMotion(template.motionProfile, person);
    view.bind(person.id); view.update(person, 4, null);
    compareClean(4);
    person.rifleReady = true;
    person.nativeMotion.lowReady = 0;
    syncNativeAimGoal(person);
    for (const operation of RIFLE_HAND_SAMPLES.slice(-2)) {
      view.update(person, 5, null, operation);
      compareClean(5, operation);
    }
    person.rifleReady = false;
    person.nativeMotion.lowReady = 1; syncNativeAimGoal(person);
    person.sihangShield = { ...SIHANG_SHIELD_POSES[0], installing: true };
    view.update(person, 6, null);
    person.health = 0;
    person.casualty = createCasualtyState(person, 7, sampleNraMotion(person), { variant: 0, retainGun: true });
    view.update(person, 8, null);
    const reference = compareClean(8);
    assert.deepEqual(view.snapshot.casualty, reference.snapshot.casualty, 'carry cleanup must not overwrite the native casualty pose');
  }
});

test('far carry/installation adds only four shared banks, preserves default banks and respects near/coarse budgets', async () => {
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { ...createNativeGaitProfile(track) };
  const geometry = new THREE.BoxGeometry(.4, 1.7, .3), material = new THREE.MeshStandardMaterial();
  const sampled = [], progress = [];
  let views = 0;
  function view(enabled = true) {
    views++;
    const root = new THREE.Group(), mesh = new THREE.Mesh(geometry, material), gun = new THREE.Group(), satchel = createSihangSatchel();
    gun.userData.personalWeapon = true; root.add(mesh, gun, satchel);
    return { root, motionProfile: profile, sihangShieldPoses: enabled, drawBatches: 1, issue: null,
      optionalAttachments: [{ mesh: satchel, enabled: sihangShieldInstalling, includeBank: sihangShieldInstalling }],
      createView: () => view(enabled), createFarView: () => view(enabled), bind() {},
      update(person) {
        sampled.push(person.sihangShield?.mode ?? null);
        mesh.position.y = person.sihangShield?.mode === 'roof' ? .2 : person.sihangShield ? .1 : 0;
        mesh.position.z = Math.sin(person.nativeMotion.gaitCycles * Math.PI * 2) * person.nativeMotion.weight * .01;
        gun.visible = !sihangShieldInstalling(person);
        satchel.visible = sihangShieldInstalling(person);
        root.position.copy(person.position); root.updateMatrixWorld(true);
      } };
  }
  const camera = new THREE.PerspectiveCamera(72, 1, .07, 650); camera.position.set(0, 1.67, 0);
  const original = await createNraForceRendererAsync(new THREE.Scene(), camera, view(false), 20, { team: 'enemy', uniform: 'ija1938' });
  const force = await createNraForceRendererAsync(new THREE.Scene(), camera, view(), 20,
    { team: 'enemy', uniform: 'ija1938', onProgress: item => progress.push(item) });
  assert.equal(force.counts.poseBanks, original.counts.poseBanks + 4);
  assert.equal(progress.length, force.counts.poseBanks);
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
  assert.deepEqual(sampled.filter(mode => mode !== null).slice(-2), ['roof', 'front']);
  const banks = renderer => renderer.root.children.filter(mesh => mesh.geometry?.attributes.nraSkinTint && mesh.name !== 'distant-coarse-body');
  const base = banks(original), extended = banks(force);
  const roof = extended.findIndex((mesh, index) => index < base.length &&
    !mesh.geometry.attributes.position.array.every((value, slot) => value === base[index].geometry.attributes.position.array[slot]));
  assert.ok(roof > 0, 'shield banks are inserted after the unchanged base poses, before later firing and blast poses');
  const turtle = roof + 1, installRoof = roof + 2;
  assert.notDeepEqual(extended[installRoof].geometry.attributes.position.array, extended[installRoof + 1].geometry.attributes.position.array);
  for (let index = 0; index < base.length; index++) {
    const added = index >= roof ? 4 : 0;
    assert.deepEqual(extended[index + added].geometry.attributes.position.array, base[index].geometry.attributes.position.array);
    assert.deepEqual(extended[index + added].geometry.morphAttributes, base[index].geometry.morphAttributes);
  }
  await force.prepare({ async compileAsync() {} });
  const people = Array.from({ length: 20 }, (_, slot) => {
    const person = { ...actor({ ...SIHANG_SHIELD_POSES[slot % 2], slot }), id: `shield-${slot}`, unitId: 'demolition',
      position: new THREE.Vector3((slot % 5 - 2) * .5, 0, -60 - Math.floor(slot / 5)),
      heading: 0, walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
    person.nativeMotion = createNraMotion(profile, person); return person;
  });
  const coarse = force.root.children.filter(mesh => mesh.name === 'distant-coarse-body');
  const coarseRoof = coarse.length - 4, coarseTurtle = coarseRoof + 1;
  force.update(people, 0, null, 'high', { detailLimit: 0 });
  assert.equal(force.counts.near, 0); assert.equal(force.counts.far, 20);
  assert.equal(coarse[coarseRoof].count + extended[roof].count, 10);
  assert.equal(coarse[coarseTurtle].count + extended[turtle].count, 10);
  assert.equal(force.counts.coarse, 20);
  const allocatedViews = views, meshes = force.root.children.length;
  for (let frame = 1; frame < 5; frame++) force.update(people, frame, null, 'high', { detailLimit: 0 });
  assert.equal(views, allocatedViews); assert.equal(force.root.children.length, meshes);
  for (const person of people) {
    person.nativeMotion.weight = 1; person.nativeMotion.speed = 1.75;
    person.nativeMotion.gaitCycles = .25; person.nativeMotion.phaseDistance = person.nativeMotion.distance;
  }
  force.update(people, 5, null, 'high', { detailLimit: 0 });
  assert.equal(force.counts.near, 0); assert.equal(force.counts.coarse, 0, 'marching keeps the shared animated far mesh');
  assert.equal(extended[roof].count, 10); assert.equal(coarse[coarseRoof].count, 0);
  const first = { morphTargetInfluences: [0, 0] };
  extended[roof].getMorphAt(0, first);
  assert.deepEqual(first.morphTargetInfluences, [1, 0]);
  people.forEach(person => { person.nativeMotion.gaitCycles = .75; });
  force.update(people, 6, null, 'high', { detailLimit: 0 });
  extended[roof].getMorphAt(0, first);
  assert.deepEqual(first.morphTargetInfluences, [0, 1], 'opposite foot phase changes the same shared instance');
  people[0].sihangShield.installing = true;
  const weaponState = JSON.stringify(people.map(person => person.rifle));
  force.update(people, 7, null, 'high', { detailLimit: 0 });
  assert.equal(extended[installRoof].count + coarse[coarseRoof + 2].count, 1);
  assert.equal(force.root.children.filter(mesh => mesh.name === 'sihang-demolition-satchel').length, 2, 'only installation banks allocate satchels');
  assert.equal(force.root.children.filter(mesh => mesh.name === 'sihang-demolition-satchel').reduce((sum, mesh) => sum + mesh.count, 0), 1);
  assert.equal(force.root.children.find(mesh => mesh.name === 'owned-weapon-rifle').count, 0,
    'both hands carry the heavy shield; nobody simultaneously holds a rifle');
  assert.equal(JSON.stringify(people.map(person => person.rifle)), weaponState);
  people[0].health = 0;
  people[0].casualty = createCasualtyState(people[0], 0, null, { variant: 0, retainGun: true });
  force.update(people, 3, null, 'high', { detailLimit: 0 });
  assert.equal(coarse[coarseRoof].count + extended[roof].count, 9, 'corpse must select its original casualty bank');
  assert.equal(force.root.children.filter(mesh => mesh.name === 'sihang-demolition-satchel').reduce((sum, mesh) => sum + mesh.count, 0), 0);
  for (const person of people) person.position.z = -5;
  force.update(people, 4, null, 'low');
  assert.ok(force.counts.near <= 3); assert.ok(force.counts.poolSize <= 6);
});

test('bounded two-key walking weights alternate feet continuously and preserve a stationary carry', () => {
  assert.deepEqual(sihangShieldWalkWeights(.25, 1), [1, 0]);
  assert.deepEqual(sihangShieldWalkWeights(.75, 1), [0, 1]);
  assert.deepEqual(sihangShieldWalkWeights(.5, 1), [.5, .5]);
  assert.deepEqual(sihangShieldWalkWeights(.2, 0), [0, 0]);
  assert.deepEqual(sihangShieldWalkWeights(.25, .4), [.4, 0]);
  assert.deepEqual(sihangShieldWalkWeights(0, 1), sihangShieldWalkWeights(1, 1));
});
