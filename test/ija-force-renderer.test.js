import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIjaForceRenderer } from '../src/ija-character.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';

test('all 100 enemy identities use Japanese near/far views without changing combat proxies, health or weapons', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.67, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { idle: track, run: track, strideMeters: 2, muzzle: [0, 0, -.8] };
  const material = new THREE.MeshStandardMaterial(), near = new THREE.BoxGeometry(.4, 1.7, .3), far = new THREE.TetrahedronGeometry(.8);
  let farViews = 0;
  function view(level = 'near') {
    const root = new THREE.Group(); root.add(new THREE.Mesh(level === 'near' ? near : far, material));
    const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(gun);
    const hidden = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), material); hidden.visible = false; root.add(hidden);
    let id = null, actor = null;
    return { root, motionProfile: profile, drawBatches: 1, createView: view,
      createFarView() { farViews++; return view('far'); },
      bind(value) { id = value; actor = null; root.visible = false; },
      get actorId() { return id; }, issue: null,
      update(person) { actor = person; root.position.copy(person.position); root.updateMatrixWorld(true); root.visible = true; },
      get snapshot() { return { actorId: id, soldier: actor ? { health: actor.health } : null }; } };
  }
  const renderer = createIjaForceRenderer(scene, camera, view());
  await renderer.prepare({ async compileAsync() {} });
  const actors = Array.from({ length: 100 }, (_, index) => {
    const actor = { id: `enemy-${index}`, unitId: `enemy-${Math.floor(index / 10)}`, team: 'enemy', heading: Math.PI,
      health: 100, model: new THREE.Group(), position: new THREE.Vector3((index % 10 - 5) * 1.5, 0, -5 - Math.floor(index / 10) * 4),
      walkPhase: index * .1, locomotion: { speed: 0 }, vehicleId: null, deathTime: 0,
      rifle: createRifleState(index % 11 === 10 ? 'type11' : index % 11 === 9 ? 'sniper' : 'rifle') };
    actor.nativeMotion = createNraMotion(profile, actor); return actor;
  });
  const before = actors.map(actor => ({ model: actor.model, weapon: { ...actor.rifle } }));
  renderer.update(actors, 1, null, 'high');
  assert.equal(renderer.snapshot.assigned, 100);
  assert.equal(renderer.excludedIds.size, 100);
  assert.equal(new Set(renderer.snapshot.members.map(member => member.id)).size, 100);
  assert.ok(renderer.snapshot.members.every(member => member.uniform === 'ija1938' && member.helmet));
  assert.ok(renderer.counts.near > 0 && renderer.counts.near <= 6 && renderer.counts.far > 0);
  assert.equal(farViews, 1, 'pose banks share one far-detail template');
  for (const bank of renderer.root.children.filter(node => node.isInstancedMesh).slice(0, renderer.snapshot.poseBanks)) {
    assert.equal(bank.geometry.attributes.position.count, 12, 'far body banks must not bake the near mesh, hidden LOD or personal gun');
  }
  assert.ok(renderer.snapshot.members.some(member => member.weaponModel === 'type11' && member.tier === 'instanced'));
  assert.ok(renderer.snapshot.members.some(member => member.weaponModel === 'sniper' && member.tier === 'instanced'));
  assert.ok(renderer.root.children.some(mesh => mesh.name === 'owned-weapon-sniper' && mesh.count > 0));
  actors.forEach((actor, index) => {
    assert.equal(actor.model, before[index].model);
    assert.deepEqual(actor.rifle, before[index].weapon);
    assert.equal(actor.health, 100);
  });
  renderer.update(actors, 2, null, 'low'); assert.ok(renderer.counts.near <= 3);
  const casualty = actors.find(actor => actor.id === renderer.focusedSnapshot.actorId);
  casualty.health = 0; casualty.deathTime = 2;
  renderer.update(actors, 15, null, 'high');
  assert.notEqual(renderer.snapshot.members.find(member => member.id === casualty.id).tier, 'hidden', 'corpse expiration is shared policy, not a renderer timer');
  renderer.remove(actors); renderer.update([], 16, null, 'high');
  assert.equal(renderer.excludedIds.size, 0);
  const replacement = { ...actors[0], id: 'enemy-respawn-101', health: 100 };
  replacement.nativeMotion = createNraMotion(profile, replacement);
  renderer.update([replacement], 17, null, 'high');
  assert.equal(renderer.snapshot.assigned, 1); assert.equal(renderer.snapshot.members[0].uniform, 'ija1938');
  assert.throws(() => renderer.update([{ ...replacement, team: 'friendly' }], 18, null, 'high'), /cannot use the enemy/);

  replacement.groundType = 'infantry';
  replacement.position.set(0, 0, -40);
  replacement.bayonet = { mode: 'charge', extension: 0 };
  replacement.nativeMotion.weight = 1;
  replacement.nativeMotion.speed = 4.8;
  renderer.update([replacement], 19, null, 'high');
  const banks = renderer.root.children.filter(mesh => mesh.geometry?.attributes.nraSkinTint && mesh.name !== 'distant-coarse-body');
  const coarseBanks = renderer.root.children.filter(mesh => mesh.name === 'distant-coarse-body');
  assert.equal(renderer.snapshot.poseBanks, 18, 'original poses plus separate compact corpse presentation');
  assert.equal(banks.length, 18);
  assert.equal(coarseBanks.length, banks.filter(bank => bank.geometry.morphAttributes.position?.length !== 5).length,
    'active hand-operation poses do not duplicate coarse geometry');
  assert.equal(banks.slice(7, 13).reduce((count, mesh, index) => count + mesh.count + coarseBanks[index + 7].count, 0), 1,
    'the far charging actor uses exactly one melee body pose across both geometry tiers');
  const weaponParts = renderer.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle' && mesh.count);
  const weaponBounds = new THREE.Box3();
  for (const mesh of weaponParts) {
    mesh.geometry.computeBoundingBox(); weaponBounds.union(mesh.geometry.boundingBox);
  }
  assert.ok(weaponBounds.min.z < -1.34, 'the instanced enemy rifle includes the fixed blade');
  replacement.bayonet = { mode: 'thrust', extension: 1 };
  renderer.update([replacement], 19.2, null, 'high');
  assert.equal(banks[15].count + coarseBanks[15].count, 1, 'fully extended distant thrust uses its matching body/weapon pose');
  replacement.weaponBlocked = true;
  renderer.update([replacement], 19.3, null, 'high');
  assert.equal(banks[16].count + coarseBanks[16].count, 1, 'blocked distant soldiers use a matching two-handed safe carry bank');
});
