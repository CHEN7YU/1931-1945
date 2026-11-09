import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeNraGeometry, createNraForceRenderer, createNraForceRendererAsync, settledNraGeometry, nativeActionWeights } from '../src/nra-force-renderer.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';
import { createCasualtyState } from '../src/casualties.js';
import { createNativeGaitProfile } from '../src/nra-gait.js';
import { readFile } from 'node:fs/promises';
import { createBayonetState } from '../src/bayonet.js';
import { FIRING_POSES } from '../src/combat-posture.js';
import { createDadaoState } from '../src/dadao.js';
import { loadDadaoSurfaces } from '../src/dadao-surface.js';

test('distant action sampling has convex continuous weights including the planted-step boundaries', () => {
  for (const times of [null, [0, .15, .3, .65, 1], [0, .15, .3, 1]]) {
    const frames = times?.length ?? 5;
    for (let frame = 0; frame <= 1000; frame++) {
      const progress = frame / 1000, weights = nativeActionWeights(progress, frames, times);
      assert.ok(weights.every(weight => weight >= 0 && weight <= 1));
      assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
      const projected = weights.reduce((sum, weight, index) => sum + weight * (times?.[index] ?? index / (frames - 1)), 0);
      assert.ok(Math.abs(projected - progress) < 1e-12);
    }
    for (const value of times ?? [0, .25, .5, .75, 1]) {
      const exact = nativeActionWeights(value, frames, times);
      assert.equal(exact.filter(weight => weight === 1).length, 1);
      if (value > 0) {
        const before = nativeActionWeights(value - 1e-8, frames, times);
        assert.ok(before.every((weight, index) => Math.abs(weight - exact[index]) < 1e-6));
      }
    }
  }
  for (const value of [-1, 1.1, NaN]) assert.throws(() => nativeActionWeights(value, 5), RangeError);
  assert.throws(() => nativeActionWeights(.5, 1), RangeError);
  assert.throws(() => nativeActionWeights(.5, 3, [0, 0, 1]), RangeError);
});

test('settled LOD preserves the selected pose without cloning or retaining discarded morph frames', () => {
  const source = new THREE.BoxGeometry(1, 2, 1);
  source.morphAttributes.position = Array.from({ length: 6 }, (_, index) => {
    const attribute = source.attributes.position.clone();
    for (let vertex = 0; vertex < attribute.count; vertex++) attribute.setY(vertex, attribute.getY(vertex) + index * .1);
    return attribute;
  });
  source.morphAttributes.normal = Array.from({ length: 6 }, () => source.attributes.normal.clone());
  const expected = source.clone();
  expected.setAttribute('position', source.morphAttributes.position.at(-1).clone());
  expected.setAttribute('normal', source.morphAttributes.normal.at(-1).clone());
  expected.morphAttributes = {}; expected.computeBoundingBox(); expected.computeBoundingSphere();
  for (const attributes of Object.values(source.morphAttributes)) for (const attribute of attributes.slice(0, -1))
    attribute.clone = () => { throw new Error('Unused morph frame was copied'); };
  const actual = settledNraGeometry(source, true);
  for (const name of Object.keys(expected.attributes)) assert.deepEqual(actual.attributes[name].array, expected.attributes[name].array);
  assert.deepEqual(actual.morphAttributes, {});
  assert.deepEqual(actual.boundingBox, expected.boundingBox);
  assert.deepEqual(actual.boundingSphere, expected.boundingSphere);
  actual.dispose(); expected.dispose(); source.dispose();
});

test('distant shared geometry preserves actual transformed skin vertices, normals, UVs and material groups', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.attributes.position.count;
  const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) weights[index * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial()), bone = new THREE.Bone();
  mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  bone.position.y = .3; bone.rotation.z = .2; mesh.position.set(1, 2, 3); mesh.updateMatrixWorld(true);
  const baked = bakeNraGeometry(mesh);
  assert.equal(baked.attributes.skinIndex, undefined); assert.equal(baked.attributes.skinWeight, undefined);
  assert.deepEqual(baked.groups, geometry.groups);
  assert.deepEqual(Array.from(baked.attributes.uv.array), Array.from(geometry.attributes.uv.array));
  for (let index = 0; index < count; index++) {
    const expected = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index);
    mesh.applyBoneTransform(index, expected); mesh.localToWorld(expected);
    assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(baked.attributes.position, index)) < 1e-6);
    assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(baked.attributes.normal, index).length() - 1) < 1e-6);
  }
  assert.ok(baked.boundingSphere.radius > .5);
  baked.dispose(); geometry.dispose(); mesh.material.dispose();
});

for (const team of ['enemy', 'friendly']) test(`phase-only selection and empty-batch visibility preserve ${team} body, weapon and flag instances across transitions and casualties`, async () => {
  if (team === 'friendly') await loadDadaoSurfaces(1, { async loadAsync() { return new THREE.Texture({ width: 1, height: 1 }); } });
  const moduleUrl = new URL('../src/nra-force-renderer.js', import.meta.url);
  const current = await readFile(moduleUrl, 'utf8');
  assert.equal((current.match(/sampleNraPhase\(actor\)/g) ?? []).length, 1, 'reference must replace the actual far-only call');
  let reference = current.replace('sampleNraPhase(actor)', 'sampleNraMotion(actor, false)');
  for (const statement of ['mesh.visible = count > 0;', 'mesh.visible = group.count > 0;',
    'attachment.mesh.visible = attachment.count > 0;']) {
    assert.equal(reference.split(statement).length, 2, 'reference must remove exactly one visibility guard');
    reference = reference.replace(statement, '');
  }
  const source = reference
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('.')
      ? new URL(specifier, moduleUrl).href : import.meta.resolve(specifier)}'`);
  const { createNraForceRenderer: createReference } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { ...createNativeGaitProfile(track),
    ...Object.fromEntries(Object.keys(FIRING_POSES).map(name => [name, track])) };
  const geometry = new THREE.BoxGeometry(.4, 1.7, .3);
  const material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), flag = new THREE.Mesh(geometry, material); flag.name = 'flag';
    root.add(new THREE.Mesh(geometry, material), flag);
    const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(gun);
    return { root, motionProfile: profile, drawBatches: 1, createView: view, issue: null,
      optionalAttachments: [{ mesh: flag, enabled: () => true }], bind() {},
      update(person) { root.position.copy(person.position); root.updateMatrixWorld(true); root.visible = true; },
      get snapshot() { return null; } };
  }
  const progress = [];
  const forces = await Promise.all([createReference, createNraForceRenderer, createNraForceRendererAsync].map(create =>
    create(new THREE.Scene(), camera, view(), 24, { team, uniform: team === 'enemy' ? 'enemy' : 'nra88',
      onProgress: item => progress.push(item) })));
  const geometryData = force => force.root.children.filter(mesh => mesh.isInstancedMesh).map(mesh => ({
    index: mesh.geometry.index?.array,
    attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name, attribute.array])),
    morphs: Object.fromEntries(Object.entries(mesh.geometry.morphAttributes).map(([name, attributes]) =>
      [name, attributes.map(attribute => attribute.array)])),
  }));
  assert.deepEqual(geometryData(forces[2]), geometryData(forces[1]), 'all asynchronous vertex, normal, UV, tint and morph buffers are identical');
  assert.equal(progress.length, forces[2].snapshot.poseBanks);
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
  for (const force of forces) await force.prepare({ async compileAsync() {} });
  const actors = Array.from({ length: 20 }, (_, index) => {
    const actor = { id: `phase-${index}`, unitId: `${team}-unit`, team, groundType: 'infantry', heading: 0, health: 100,
      position: new THREE.Vector3(index - 10, 0, -20), walkPhase: index * .1,
      avatarAppearance: { build: index % 3 - 1, skin: index % 2 ? '#c3a78a' : '#9d7959' },
      locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), bayonet: createBayonetState(), dadao: createDadaoState() };
    actor.nativeMotion = createNraMotion(profile, actor);
    return actor;
  });
  const capture = force => force.root.children.filter(mesh => mesh.isInstancedMesh).map(mesh => ({
    name: mesh.name, count: mesh.count, matrices: Array.from(mesh.instanceMatrix.array.subarray(0, mesh.count * 16)),
    tint: mesh.geometry.attributes.nraSkinTint ? Array.from(mesh.geometry.attributes.nraSkinTint.array.subarray(0, mesh.count * 3)) : null,
  }));
  let swordRendered = false;
  for (let frame = 0; frame < 60; frame++) {
    for (const [index, actor] of actors.entries()) {
      const motion = actor.nativeMotion, names = Object.keys(motion.posture).filter(name => profile[name]);
      actor.position.z = frame % 3 === 0 ? -8 : frame % 3 === 1 ? -24 : -60;
      actor.heading = frame * .03;
      motion.speed = (frame + index) % 6; motion.distance += .07;
      motion.gaitCycles += .03; motion.gaitAim = frame % 4 === 0 ? 1 : 0;
      motion.gaitCharge = frame % 4 === 1 ? 1 : 0; motion.weight = frame % 5 === 0 ? 0 : .8;
      motion.lowReady = frame % 2;
      for (const name of names) motion.posture[name] = 0;
      if (frame % 6 === 2) motion.posture[names[index % names.length]] = .75;
      if (frame % 6 === 3) { motion.posture[names[0]] = .35; motion.posture[names[1]] = .4; }
      actor.bayonet.mode = ['idle', 'charge', 'thrust', 'recover'][frame % 4]; actor.bayonet.extension = (frame % 3) / 2;
      actor.dadao.equipped = team === 'friendly' && index % 4 === 0 && frame % 5 !== 0;
      actor.dadao.mode = frame % 5 === 1 ? 'charge' : 'ready';
      actor.dadao.pose = { phase: ['ready', 'windup', 'cut', 'recover'][frame % 4], progress: (frame % 3) / 2 };
      if (frame === 30 && index < 3) {
        actor.health = 0; actor.casualty = createCasualtyState(actor, frame, null, { variant: 0, retainGun: index % 2 === 0 });
      }
    }
    if (frame === 45) {
      actors[3].id = 'replacement';
      actors[3].nativeMotion = createNraMotion(profile, actors[3]);
    }
    const before = actors.map(actor => JSON.stringify(actor.nativeMotion));
    for (const force of forces) force.update(actors, frame, frame % 2 ? actors[4].id : null, frame % 2 ? 'high' : 'low');
    assert.deepEqual(capture(forces[1]), capture(forces[0]), `bank occupancy and instance buffers at frame ${frame}`);
    assert.deepEqual(capture(forces[2]), capture(forces[1]), `asynchronous renderer preserves all instances at frame ${frame}`);
    swordRendered ||= forces[1].root.children.some(mesh => mesh.name.startsWith('owned-weapon-dadao') && mesh.count > 0);
    for (const mesh of forces[1].root.children.filter(child => child.isInstancedMesh)) {
      assert.equal(mesh.visible, mesh.count > 0, `empty-only visibility at frame ${frame}: ${mesh.name}`);
    }
    assert.deepEqual(forces[1].snapshot.members, forces[0].snapshot.members);
    assert.deepEqual(actors.map(actor => JSON.stringify(actor.nativeMotion)), before);
  }
  if (team === 'friendly') assert.equal(swordRendered, true, 'the short path must retain the integrated main sword selection');
  for (const force of forces) force.update([], 61, null, 'high');
  assert.deepEqual(capture(forces[1]), capture(forces[0]));
  assert.ok(forces[1].root.children.filter(child => child.isInstancedMesh).every(mesh => !mesh.visible && mesh.count === 0));
  for (const force of forces) force.update(actors, 62, null, 'high');
  assert.deepEqual(capture(forces[1]), capture(forces[0]), 'restoring actors after an empty frame preserves all instance buffers');
  const restored = forces[1].root.children.filter(child => child.isInstancedMesh);
  assert.ok(restored.some(mesh => mesh.count > 0));
  for (const mesh of restored) assert.equal(mesh.visible, mesh.count > 0, 'nonempty batches return in the first restored update');
  for (const force of forces) for (const mesh of force.root.children) if (mesh.isInstancedMesh) {
    mesh.geometry.dispose(); mesh.dispose();
  }
  geometry.dispose(); material.dispose();
});

test('weapons share body distance hysteresis, restore original detail on zoom in the same update and never change combat state', async () => {
  const camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { idle: track, run: track, strideMeters: 2, muzzle: [0, 0, -.8] };
  const geometry = new THREE.BoxGeometry(.4, 1.7, .3), material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), gun = new THREE.Group();
    gun.userData.personalWeapon = true; root.add(new THREE.Mesh(geometry, material), gun);
    return { root, motionProfile: profile, drawBatches: 1, createView: view, issue: null, bind() {},
      update(actor) { root.position.copy(actor.position); root.updateMatrixWorld(true); root.visible = true; },
      get snapshot() { return null; } };
  }
  const force = createNraForceRenderer(new THREE.Scene(), camera, view(), 4, { team: 'enemy' });
  const actor = { id: 'lod', unitId: 'enemy-unit', team: 'enemy', position: new THREE.Vector3(0, 0, -60),
    heading: .4, walkPhase: 0, health: 100, rifle: createRifleState(), bayonet: createBayonetState(), locomotion: { speed: 0 } };
  actor.nativeMotion = createNraMotion(profile, actor);
  const before = JSON.stringify(actor);
  await force.prepare({ async compileAsync() {} });
  const weaponParts = () => force.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle');
  force.update([actor], 0, null, 'high');
  assert.equal(force.snapshot.coarseWeapons, 1);
  assert.ok(force.snapshot.weaponGeometryTriangles < force.snapshot.weaponGeometryTrianglesWithoutLod * .6);
  const coarse = weaponParts().filter(mesh => mesh.count > 0);
  assert.ok(coarse.every(mesh => mesh.userData.geometryLod === 'coarse' && mesh.visible));
  const transform = Array.from(coarse[0].instanceMatrix.array.subarray(0, 16));
  const original = weaponParts().filter(mesh => mesh.userData.geometryLod === 'original');
  const originalBuffers = original.map(mesh => JSON.stringify(mesh.geometry.toJSON()));
  camera.fov = 18; camera.updateProjectionMatrix();
  force.update([actor], 1, null, 'high');
  assert.equal(force.snapshot.coarseWeapons, 0);
  assert.equal(force.snapshot.weaponGeometryTriangles, force.snapshot.weaponGeometryTrianglesWithoutLod);
  assert.ok(coarse.every(mesh => !mesh.visible && mesh.count === 0));
  assert.ok(original.every(mesh => mesh.visible && mesh.count === 1));
  assert.deepEqual(Array.from(original[0].instanceMatrix.array.subarray(0, 16)), transform);
  assert.deepEqual(original.map(mesh => JSON.stringify(mesh.geometry.toJSON())), originalBuffers);
  camera.fov = 72; camera.updateProjectionMatrix();
  force.update([actor], 2, null, 'high');
  assert.equal(force.snapshot.coarseWeapons, 1);
  force.update([], 3, null, 'high');
  assert.ok(weaponParts().every(mesh => !mesh.visible && mesh.count === 0));
  force.update([actor], 4, null, 'high');
  assert.equal(force.snapshot.coarseWeapons, 1);
  assert.equal(JSON.stringify(actor), before);
  actor.rifle = createRifleState('type11');
  const automatic = JSON.stringify(actor);
  force.update([actor], 5, null, 'high');
  assert.equal(force.snapshot.coarseWeapons, 0, 'already cheap machine guns retain their original bipod and feed silhouette');
  assert.equal(force.snapshot.weaponGeometryTriangles, force.snapshot.weaponGeometryTrianglesWithoutLod);
  assert.equal(JSON.stringify(actor), automatic);
  for (const mesh of force.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
  geometry.dispose(); material.dispose();
});

test('shared casualty banks grow explicitly when the minimum retention time temporarily exceeds their capacity', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = createNativeGaitProfile(track), geometry = new THREE.BoxGeometry(.4, 1.7, .3);
  const material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), flag = new THREE.Mesh(geometry, material); flag.name = 'corpse-flag';
    root.add(new THREE.Mesh(geometry, material), flag);
    const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(gun);
    return { root, motionProfile: profile, drawBatches: 1, createView: view, issue: null,
      optionalAttachments: [{ mesh: flag, enabled: () => true }],
      bind() {}, update(person) { flag.visible = true; root.position.copy(person.position); root.updateMatrixWorld(true); root.visible = true; },
      get snapshot() { return null; } };
  }
  const renderer = createNraForceRenderer(scene, camera, view(), 2);
  await renderer.prepare({ async compileAsync() {} });
  const bodies = Array.from({ length: 10 }, (_, index) => {
    const actor = { id: `body-${index}`, unitId: 'old-unit', team: 'friendly', heading: 0, health: 0,
      position: new THREE.Vector3(index * .1, 0, -50), walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
    actor.nativeMotion = createNraMotion(profile, actor);
    actor.casualty = createCasualtyState(actor, 0, null, { variant: 0, retainGun: false });
    return actor;
  });
  renderer.update(bodies, 30, null, 'high');
  assert.equal(renderer.snapshot.far, 10);
  assert.equal(renderer.snapshot.coarse, 10);
  const occupied = renderer.root.children.filter(mesh => mesh.isInstancedMesh && mesh.count > 0);
  assert.equal(occupied.filter(mesh => !mesh.name.startsWith('owned-weapon-')).length, 2);
  assert.ok(occupied.some(mesh => mesh.name === 'owned-weapon-rifle'));
  assert.ok(occupied.every(mesh => mesh.count === 10 && mesh.instanceMatrix.count >= 10), 'body, owned firearm and attached flag grow together');
  renderer.update(bodies, 30, null, 'high');
  assert.equal(renderer.snapshot.far, 10);
  for (const mesh of renderer.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
  geometry.dispose(); material.dispose();
});

test('a hidden previously equipped blade cannot replace the firearm transform in casualty banks', async () => {
  await loadDadaoSurfaces(1, { async loadAsync() { return new THREE.Texture({ width: 1, height: 1 }); } });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, -4); camera.lookAt(0, .4, 0); camera.updateMatrixWorld(true);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = createNativeGaitProfile(track), geometry = new THREE.BoxGeometry(.4, 1.7, .3);
  const material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), gun = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material), gun); gun.userData.personalWeapon = true;
    let blade = null;
    return { root, motionProfile: profile, drawBatches: 1, createView: view, issue: null, bind() {},
      update(actor) {
        if (actor.dadao && !blade) {
          blade = new THREE.Group(); blade.userData.personalWeapon = true;
          blade.position.y = 1.3; root.add(blade);
        }
        if (blade) blade.visible = Boolean(actor.dadao);
        gun.visible = !actor.dadao; gun.position.y = actor.health <= 0 ? .08 : 1.2;
        root.position.copy(actor.position); root.updateMatrixWorld(true); root.visible = true;
      } };
  }
  const force = createNraForceRenderer(scene, camera, view(), 1);
  const actor = { id: 'fallen-rifleman', team: 'friendly', unitId: 'regression', health: 0,
    position: new THREE.Vector3(), heading: 0, walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
  actor.nativeMotion = createNraMotion(profile, actor);
  actor.casualty = createCasualtyState(actor, 0, null, { variant: 2, retainGun: false });
  await force.prepare({ async compileAsync() {} });
  for (const distance of [4, 60]) {
    camera.position.z = -distance; camera.updateMatrixWorld(true);
    force.update([actor], 3, null, 'low', { detailLimit: 0 });
    assert.equal(force.snapshot.far, 1);
    assert.equal(force.snapshot.coarse, Number(distance === 60));
    if (distance === 4) {
      const body = force.root.children.find(mesh => mesh.isInstancedMesh && mesh.count &&
        mesh.geometry.attributes.nraSkinTint && mesh.geometry.morphAttributes.position?.length);
      assert.ok(body.geometry.index, 'casualty frames must reuse their original vertex identities');
      assert.equal(body.geometry.index.count, 36, 'indexing keeps every original body triangle');
      assert.equal(body.geometry.attributes.position.count, 24);
      assert.ok(body.geometry.morphAttributes.position.every(frame => frame.count === 24));
    }
    const weapons = force.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle' && mesh.count);
    assert.ok(weapons.length > 0);
    for (const mesh of weapons) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
      assert.ok(Math.abs(matrix.elements[13] - .08) < 1e-6,
        `released rifle used the hidden blade height: ${matrix.elements[13]}`);
    }
  }
  for (const mesh of force.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
  geometry.dispose(); material.dispose();
});

test('all friendly identities retain uniforms while detail pooling survives casualties and replacement deployments', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { idle: track, run: track, strideMeters: 2, muzzle: [0, 0, -.8] };
  const geometry = new THREE.BoxGeometry(.4, 1.7, .3), material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material));
    const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(gun);
    let id = null, actor = null;
    return { root, motionProfile: profile, drawBatches: 1, createView: view, issue: null,
      bind(value) { id = value; actor = null; root.visible = false; },
      get actorId() { return id; },
      update(person) { actor = person; root.position.copy(person.position); root.updateMatrixWorld(true); root.visible = true; },
      get snapshot() { return { actorId: id, soldier: actor ? { health: actor.health } : null }; } };
  }
  const force = createNraForceRenderer(scene, camera, view());
  await force.prepare({ async compileAsync() {} });
  const actors = Array.from({ length: 100 }, (_, index) => {
    const actor = { id: `soldier-${index}`, unitId: 'friendly-0', team: 'friendly', heading: 0, health: 100,
      position: new THREE.Vector3((index % 10 - 5) * 1.5, 0, -5 - Math.floor(index / 10) * 3),
      walkPhase: index * .1, locomotion: { speed: 0 }, vehicleId: null, deathTime: 0, ammo: 5,
      rifle: createRifleState(index % 11 === 10 ? 'zb26' : index % 11 === 9 ? 'sniper' : 'rifle') };
    actor.nativeMotion = createNraMotion(profile, actor); return actor;
  });
  force.update(actors, 1, actors[0].id, 'high');
  assert.equal(force.snapshot.assigned, 100);
  assert.equal(force.excludedIds.size, 100);
  assert.equal(force.snapshot.members.find(member => member.id === actors[0].id).tier, 'hidden');
  assert.ok(force.snapshot.near <= 6); assert.equal(force.snapshot.poolSize, 6);
  assert.ok(force.snapshot.far > 0);
  assert.ok(force.snapshot.members.some(member => member.weaponModel === 'sniper' && member.tier === 'instanced'));
  assert.ok(force.root.children.some(mesh => mesh.name === 'owned-weapon-sniper' && mesh.count > 0));
  const observed = force.focusedSnapshot.actorId;
  const casualty = actors.find(actor => actor.id === observed); casualty.health = 0; casualty.deathTime = 1;
  force.update(actors, 1.2, actors[0].id, 'high');
  assert.notEqual(force.focusedSnapshot.actorId, observed);
  assert.equal(force.focusedSnapshot.soldier.health, 100);
  assert.ok(actors.every(actor => actor.ammo === 5), 'View substitution cannot refill personal weapons');
  force.update(actors, 14, actors[0].id, 'high');
  assert.notEqual(force.snapshot.members.find(member => member.id === observed).tier, 'hidden', 'rendering must not independently expire corpses after twelve seconds');
  for (const actor of actors) actor.position.z = -60;
  force.update(actors, 15, null, 'high');
  assert.equal(force.counts.lodReady, true);
  assert.equal(force.snapshot.coarse, actors.length);
  assert.ok(force.snapshot.members.every(member => member.geometryLod === 'coarse'));
  camera.fov = 18; camera.updateProjectionMatrix();
  force.update(actors, 15, null, 'high');
  assert.equal(force.snapshot.coarse, 0, 'zoom immediately restores the original full body geometry');
  assert.equal(force.snapshot.far, actors.length);
  camera.fov = 72; camera.updateProjectionMatrix(); camera.rotation.y = Math.PI;
  force.update(actors, 15, null, 'high');
  assert.equal(force.snapshot.culled, actors.length);
  assert.equal(force.snapshot.coarse, 0);
  actors[0].position.x += .1; actors[0].heading += .3;
  camera.rotation.y = 0;
  force.update(actors, 15, null, 'high');
  assert.equal(force.snapshot.coarse, actors.length, 'turning back uses the current actor state immediately');
  const body = force.root.children.find(mesh => mesh.name === 'distant-coarse-body' && mesh.count === actors.length);
  assert.ok(body);
  const actual = new THREE.Matrix4(), expected = new THREE.Matrix4().compose(actors[0].position,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, actors[0].heading, 0)), new THREE.Vector3(1, 1, 1));
  body.getMatrixAt(0, actual);
  assert.ok(actual.elements.every((value, index) => Math.abs(value - expected.elements[index]) < 1e-6),
    'the first visible frame uses the updated position and heading, not its previous offscreen transform');
  camera.position.z = -55;
  force.update(actors, 15, null, 'high');
  assert.equal(force.snapshot.coarse, 0, 'nearby actors outside the skinned-view budget still get original geometry');
  assert.ok(force.snapshot.near <= 6);
  force.remove(actors); force.update([], 15, null, 'high');
  assert.equal(force.snapshot.assigned, 0); assert.equal(force.focusedSnapshot, null);
  const replacement = { ...actors[1], id: 'replacement-101', health: 100 };
  replacement.nativeMotion = createNraMotion(profile, replacement);
  force.update([replacement], 15, null, 'high');
  assert.equal(force.snapshot.assigned, 1);
  assert.equal(force.snapshot.members[0].uniform, 'nra88');
  assert.equal(force.snapshot.members[0].helmet, true);
  assert.equal(force.snapshot.poolSize, 6);
  for (const mesh of force.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
  geometry.dispose(); material.dispose();
});
