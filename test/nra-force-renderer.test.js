import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeNraGeometry, createNraForceRenderer } from '../src/nra-force-renderer.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createCasualtyState } from '../src/casualties.js';
import { createNativeGaitProfile } from '../src/nra-gait.js';

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

test('shared casualty banks grow explicitly when the minimum retention time temporarily exceeds their capacity', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = createNativeGaitProfile(track), geometry = new THREE.BoxGeometry(.4, 1.7, .3);
  const material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), flag = new THREE.Mesh(geometry, material); flag.name = 'corpse-flag';
    root.add(new THREE.Mesh(geometry, material), flag);
    return { root, motionProfile: profile, drawBatches: 1, createView: view, issue: null,
      optionalAttachments: [{ mesh: flag, enabled: () => true }],
      bind() {}, update(person) { flag.visible = true; root.position.copy(person.position); root.updateMatrixWorld(true); root.visible = true; },
      get snapshot() { return null; } };
  }
  const renderer = createNraForceRenderer(scene, camera, view(), 2);
  const bodies = Array.from({ length: 10 }, (_, index) => {
    const actor = { id: `body-${index}`, unitId: 'old-unit', team: 'friendly', heading: 0, health: 0,
      position: new THREE.Vector3(index * .1, 0, -50), walkPhase: 0, locomotion: { speed: 0 } };
    actor.nativeMotion = createNraMotion(profile, actor);
    actor.casualty = createCasualtyState(actor, 0, null, { variant: 0, retainGun: false });
    return actor;
  });
  renderer.update(bodies, 30, null, 'high');
  assert.equal(renderer.snapshot.far, 10);
  const occupied = renderer.root.children.filter(mesh => mesh.isInstancedMesh && mesh.count > 0);
  assert.equal(occupied.length, 2);
  assert.ok(occupied.every(mesh => mesh.count === 10 && mesh.instanceMatrix.count >= 10), 'body and attached flag grow together');
  renderer.update(bodies, 30, null, 'high');
  assert.equal(renderer.snapshot.far, 10);
  for (const mesh of renderer.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
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
      walkPhase: index * .1, locomotion: { speed: 0 }, vehicleId: null, deathTime: 0, ammo: 5 };
    actor.nativeMotion = createNraMotion(profile, actor); return actor;
  });
  force.update(actors, 1, actors[0].id, 'high');
  assert.equal(force.snapshot.assigned, 100);
  assert.equal(force.excludedIds.size, 100);
  assert.equal(force.snapshot.members.find(member => member.id === actors[0].id).tier, 'hidden');
  assert.ok(force.snapshot.near <= 6); assert.equal(force.snapshot.poolSize, 6);
  assert.ok(force.snapshot.far > 0);
  const observed = force.focusedSnapshot.actorId;
  const casualty = actors.find(actor => actor.id === observed); casualty.health = 0; casualty.deathTime = 1;
  force.update(actors, 1.2, actors[0].id, 'high');
  assert.notEqual(force.focusedSnapshot.actorId, observed);
  assert.equal(force.focusedSnapshot.soldier.health, 100);
  assert.ok(actors.every(actor => actor.ammo === 5), 'View substitution cannot refill personal weapons');
  force.update(actors, 14, actors[0].id, 'high');
  assert.notEqual(force.snapshot.members.find(member => member.id === observed).tier, 'hidden', 'rendering must not independently expire corpses after twelve seconds');
  force.remove(actors); force.update([], 14, null, 'high');
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
