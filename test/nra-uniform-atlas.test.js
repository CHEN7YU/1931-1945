import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNraAtlas, mergeNraPose } from '../src/nra-atlas.js';
import { createNraForceRenderer } from '../src/nra-force-renderer.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';

test('indexed distant poses preserve every triangle attribute bit, seams and source geometry', () => {
  const geometry = new THREE.BoxGeometry(.4, 1.7, .3);
  const material = new THREE.MeshStandardMaterial();
  const expanded = geometry.toNonIndexed(), before = geometry.attributes.position.array.slice();
  const atlas = { mapGeometry(target) {
    target.setAttribute('nraUniformUv', target.attributes.uv.clone());
  } };
  const merged = mergeNraPose([{ geometry, material, skin: true }], atlas);
  assert.ok(merged.index);
  assert.equal(merged.index.count, expanded.attributes.position.count);
  assert.equal(merged.attributes.position.count, geometry.attributes.position.count);
  const restored = merged.toNonIndexed();
  for (const name of ['position', 'normal', 'uv']) {
    assert.deepEqual(new Uint32Array(restored.attributes[name].array.buffer),
      new Uint32Array(expanded.attributes[name].array.buffer), name);
  }
  assert.deepEqual(restored.attributes.nraUniformUv.array, expanded.attributes.uv.array);
  assert.ok(restored.attributes.nraSkinRegion.array.every(value => value === 1));
  assert.deepEqual(geometry.attributes.position.array, before);
  assert.deepEqual(merged.boundingBox, geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.attributes.position));
  geometry.dispose(); expanded.dispose(); merged.dispose(); restored.dispose(); material.dispose();
});

test('exact indexing does not weld close positions, material UV seams or skin-region boundaries', () => {
  const material = new THREE.MeshStandardMaterial();
  const first = new THREE.PlaneGeometry(1, 1), second = first.clone();
  second.translate(.000001, 0, 0);
  const atlas = { mapGeometry() {} };
  const close = mergeNraPose([{ geometry: first, material }, { geometry: second, material }], atlas);
  assert.equal(close.attributes.position.count, 8, 'nearby but unequal vertices are not rounded together');
  const seam = first.clone();
  for (let i = 0; i < seam.attributes.uv.count; i++) seam.attributes.uv.setX(i, seam.attributes.uv.getX(i) + .25);
  const seamed = mergeNraPose([{ geometry: first, material }, { geometry: seam, material }], atlas);
  assert.equal(seamed.attributes.position.count, 8, 'equal positions with different UVs remain separate');
  const merged = mergeNraPose([{ geometry: first, material, skin: true }, { geometry: second, material, skin: false }], atlas);
  assert.equal(merged.attributes.position.count, 8);
  assert.equal(merged.index.count, 12);
  const restored = merged.toNonIndexed();
  assert.ok([...restored.attributes.nraSkinRegion.array.slice(0, 6)].every(value => value === 1));
  assert.ok([...restored.attributes.nraSkinRegion.array.slice(6)].every(value => value === 0));
  assert.notEqual(restored.attributes.position.getX(0), restored.attributes.position.getX(6));
  first.dispose(); second.dispose(); seam.dispose(); close.dispose(); seamed.dispose(); merged.dispose(); restored.dispose(); material.dispose();
});

test('exact pose indices retain references beyond the 16-bit vertex limit', () => {
  const geometry = new THREE.PlaneGeometry(1, 1, 256, 256), material = new THREE.MeshStandardMaterial();
  const merged = mergeNraPose([{ geometry, material }], { mapGeometry() {} });
  assert.ok(merged.index.array instanceof Uint32Array);
  assert.equal(merged.attributes.position.count, 257 * 257);
  assert.equal(merged.index.count, geometry.index.count);
  assert.equal(merged.index.array.reduce((max, value) => Math.max(max, value), 0), 257 * 257 - 1);
  const restored = merged.toNonIndexed(), expected = geometry.toNonIndexed();
  assert.deepEqual(restored.attributes.position.array, expected.attributes.position.array);
  geometry.dispose(); merged.dispose(); restored.dispose(); expected.dispose(); material.dispose();
});

test('one shared pose bank selects different A/B atlas tiles per instance without tinting skin or duplicating poses', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
  try {
    const geometry = new THREE.BoxGeometry(.4, 1.7, .3);
    const materialA = new THREE.MeshStandardMaterial({ color: '#858a50' });
    const materialB = new THREE.MeshStandardMaterial({ color: '#6f7562' });
    const uniformMaterials = new Map([[materialA, materialB]]);
    const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, materialA));
    const atlas = createNraAtlas(root, uniformMaterials);
    const merged = mergeNraPose([{ geometry, material: materialA }], atlas);
    assert.equal(atlas.hasUniformVariants, true);
    assert.ok(merged.attributes.nraUniformUv);
    assert.notDeepEqual(merged.attributes.uv.array, merged.attributes.nraUniformUv.array);
    const shader = { vertexShader: '#include <common>\n#include <begin_vertex>\n#include <uv_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>' };
    atlas.material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /mix\(vMapUv, nraUniformUv, nraUniformVariant\)/);
    assert.match(shader.fragmentShader, /diffuseColor.rgb \*= vNraSkinTint/);

    const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
    const profile = { idle: track, run: track, strideMeters: 2, muzzle: [0, 0, -.8] };
    function view() {
      const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, materialA));
      const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(gun);
      return { root, uniformMaterials, motionProfile: profile, drawBatches: 1, createView: view,
        bind() {}, update() { root.visible = true; root.updateMatrixWorld(true); }, get snapshot() { return {}; } };
    }
    const camera = new THREE.PerspectiveCamera(72, 1, .07, 650); camera.position.set(0, 1.67, 0);
    const force = createNraForceRenderer(new THREE.Scene(), camera, view());
    const actors = ['A', 'B'].map((uniform, index) => {
      const actor = { id: `far-${uniform}`, team: 'friendly', unitId: `friendly-${index * 5}`,
        position: new THREE.Vector3(index - .5, 0, -50), heading: 0, health: 100, walkPhase: 0, locomotion: { speed: 0 },
        avatarAppearance: { uniform, build: 0, skin: '#ffffff' }, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(profile, actor); return actor;
    });
    force.update(actors, 0, null, 'high');
    assert.equal(force.counts.poseBanks, 23, 'seven original banks plus sixteen shared allied melee poses, independent of A/B variants');
    const bank = force.root.children.find(node => node.isInstancedMesh && node.count > 0);
    assert.equal(bank.count, 2);
    assert.deepEqual([...bank.geometry.attributes.nraUniformVariant.array.slice(0, 2)], [0, 1]);
    force.update(actors.slice().reverse(), 1, null, 'low');
    assert.deepEqual([...bank.geometry.attributes.nraUniformVariant.array.slice(0, 2)], [1, 0]);
    assert.deepEqual(force.snapshot.members.map(member => member.uniformVariant), ['B', 'A']);
    geometry.dispose(); merged.dispose(); materialA.dispose(); materialB.dispose();
  } finally { globalThis.document = previous; }
});
