import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitIjaPoint, fitIjaProportions } from '../uniform-study/proportions.js';
import { createIjaRifleFlag, hasIjaRifleFlag } from '../src/ija-rifle-flag.js';
import { createNraForceRenderer } from '../src/nra-force-renderer.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';

test('compact proportions preserve boot clearance and head height instead of flattening the whole model', () => {
  const fitted = y => fitIjaPoint(new THREE.Vector3(.1, y, .1));
  assert.equal(fitted(.025).y, .025);
  assert.equal(fitted(.14).y, .14);
  assert.ok(Math.abs(fitted(.98).y - .91505) < 1e-8);
  assert.ok(Math.abs(fitted(1.74748346).y - 1.68253346) < 1e-8);
  assert.ok(Math.abs(fitted(1.74).y - fitted(1.465).y - .275) < 1e-8);
  assert.equal(fitted(1).x, .10500000000000001);
  for (const boundary of [.14, .98, 1.465]) {
    assert.ok(Math.abs(fitted(boundary + 1e-8).y - fitted(boundary - 1e-8).y) < 3e-8);
  }
});

test('offline refit moves joints, inverse binds, both LODs and hip animation together', () => {
  const root = new THREE.Group(), hips = new THREE.Bone(), head = new THREE.Bone();
  hips.name = 'Hips'; hips.position.y = .98; head.name = 'Head'; head.position.y = .6;
  root.add(hips); hips.add(head); root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([hips, head]);
  const meshes = ['near', 'far'].map(name => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, .98, 0, .1, 1.58, 0, -.1, 1.58, 0], 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = name; root.add(mesh); mesh.bind(skeleton, new THREE.Matrix4()); return mesh;
  });
  const track = new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, .98, 0, 0, 1, 0]);
  fitIjaProportions(root, skeleton, [new THREE.AnimationClip('idle', 1, [track])]);
  assert.ok(Math.abs(hips.position.y - .91505) < 1e-8);
  assert.ok(Math.abs(head.getWorldPosition(new THREE.Vector3()).y - 1.51505) < 1e-8);
  assert.ok(Math.abs(track.values[1] - .91505) < 1e-6);
  assert.ok(Math.abs(track.values[4] - track.values[1] - .02) < 1e-6);
  skeleton.update();
  for (const mesh of meshes) for (let index = 0; index < 3; index++) {
    const rest = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index);
    assert.ok(mesh.applyBoneTransform(index, rest.clone()).distanceTo(rest) < 1e-6);
  }
});

test('only a stable subset of enemy identities carry shared, two-sided rifle flags', () => {
  const actors = Array.from({ length: 100 }, (_, index) =>
    ({ id: `enemy-${index}`, unitId: `enemy-${Math.floor(index / 10)}`, team: 'enemy' }));
  const selected = actors.filter(hasIjaRifleFlag);
  assert.ok(selected.length >= 10 && selected.length <= 30);
  for (const actor of actors) {
    assert.equal(hasIjaRifleFlag(actor), hasIjaRifleFlag({ ...actor, health: 0, heading: 2 }));
    assert.equal(hasIjaRifleFlag({ ...actor, team: 'friendly' }), false);
  }
  assert.throws(() => hasIjaRifleFlag({ team: 'enemy' }), /owned soldier identity/);
  const first = createIjaRifleFlag(), second = createIjaRifleFlag(), gun = new THREE.Group();
  assert.equal(first.geometry, second.geometry); assert.equal(first.material, second.material);
  assert.equal(first.material.side, THREE.DoubleSide);
  assert.equal(first.userData.rifleAttachment, true);
  gun.add(first); gun.position.set(1, 2, 3); gun.rotation.set(.4, 1, .2); gun.updateMatrixWorld(true);
  assert.deepEqual(first.matrixWorld.elements, gun.matrixWorld.elements);
  assert.ok(first.geometry.boundingBox.max.y < 0, 'flag stays below the sight line');
});

test('distant flags use only selected identities and clear on cull, removal and quality changes', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { idle: track, run: track, strideMeters: 2, muzzle: [0, 0, -.8] };
  const geometry = new THREE.TetrahedronGeometry(.5), material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), body = new THREE.Mesh(geometry, material), flag = new THREE.Mesh(geometry, material);
    flag.name = 'test-flag'; root.add(body, flag);
    return { root, motionProfile: profile, drawBatches: 2, createView: view,
      optionalAttachments: [{ mesh: flag, enabled: hasIjaRifleFlag }],
      bind() { root.visible = false; }, issue: null,
      update(actor) { root.visible = true; root.position.copy(actor.position); flag.visible = hasIjaRifleFlag(actor); root.updateMatrixWorld(true); } };
  }
  const renderer = createNraForceRenderer(scene, camera, view(), 100, { team: 'enemy' });
  const actors = Array.from({ length: 100 }, (_, index) => {
    const actor = { id: `enemy-${index}`, unitId: `enemy-${Math.floor(index / 10)}`, team: 'enemy',
      position: new THREE.Vector3((index % 10 - 5) * .5, 0, -40 - Math.floor(index / 10)),
      heading: 0, health: 100, vehicleId: null, walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
    actor.nativeMotion = createNraMotion(profile, actor); return actor;
  });
  const flagCount = () => renderer.root.children.filter(mesh => mesh.name === 'test-flag').reduce((sum, mesh) => sum + mesh.count, 0);
  for (const quality of ['high', 'low']) {
    renderer.update(actors, 0, null, quality);
    assert.equal(renderer.counts.far, 100);
    assert.equal(flagCount(), actors.filter(hasIjaRifleFlag).length);
    assert.equal(renderer.counts.batches, 2, 'one body bank and one optional flag bank are counted once');
  }
  camera.rotation.y = Math.PI;
  renderer.update(actors, 1, null, 'high'); assert.equal(flagCount(), 0);
  renderer.remove(actors); renderer.update([], 2, null, 'high'); assert.equal(flagCount(), 0);
});
