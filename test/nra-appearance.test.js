import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNraAppearance, sculptNraPoint, createNraAppearanceApplicator, NRA_FACE_NAME } from '../src/nra-appearance.js';

test('individual traits are stable per owned identity and distribute across many combinations', () => {
  const people = Array.from({ length: 100 }, (_, index) => ({ id: `soldier-${index + 1}`, unitId: `friendly-${Math.floor(index / 10)}` }));
  const appearances = people.map(createNraAppearance);
  assert.ok(new Set(appearances.map(appearance => appearance.key)).size >= 40);
  assert.equal(new Set(appearances.map(appearance => appearance.face)).size, 8);
  assert.equal(new Set(appearances.map(appearance => appearance.complexion)).size, 5);
  assert.equal(new Set(appearances.map(appearance => appearance.build)).size, 3);
  assert.deepEqual(createNraAppearance(people[0]), appearances[0]);
  assert.ok(Object.isFrozen(appearances[0]));
  assert.throws(() => createNraAppearance({ id: 'unowned' }), /owned identity/);
});

test('face families change jaw and nose geometry while preserving eye socket and neck alignment', () => {
  const jaw = new THREE.Vector3(5, 162, 8), nose = new THREE.Vector3(.6, 169, 12);
  assert.ok(sculptNraPoint(jaw, 0, 0, true).distanceTo(sculptNraPoint(jaw, 1, 0, true)) > .5);
  assert.ok(sculptNraPoint(nose, 2, 0, true).distanceTo(sculptNraPoint(nose, 3, 0, true)) > .5);
  const eye = new THREE.Vector3(3.7, 173, 9.5), neck = new THREE.Vector3(3, 150, 0);
  for (let face = 0; face < 8; face++) {
    assert.ok(sculptNraPoint(eye, face, 0, true).distanceTo(eye) < .02);
    assert.ok(sculptNraPoint(neck, face, 0, true).distanceTo(neck) < .001);
  }
});

test('build variation changes torso volume but not height, hand geometry or personal resources', () => {
  const chest = new THREE.Vector3(20, 121, 10);
  const slim = sculptNraPoint(chest, 0, -1, false), broad = sculptNraPoint(chest, 0, 1, false);
  assert.ok(broad.x - slim.x > 1);
  assert.equal(slim.y, chest.y); assert.equal(broad.y, chest.y);
  assert.ok(sculptNraPoint(new THREE.Vector3(55, 112, 5), 0, 1, false).distanceTo(new THREE.Vector3(55, 112, 5)) < 1e-8);
});

test('pooled views restore neutral assets and reuse cached variants without mutating shared source geometry', () => {
  const geometry = new THREE.BoxGeometry(.1, .2, .1); geometry.translate(0, 1.65, .08);
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = NRA_FACE_NAME; mesh.bindMatrix.makeScale(100, 100, 100);
  const original = [...geometry.attributes.position.array], apply = createNraAppearanceApplicator([mesh]);
  const appearance = createNraAppearance({ id: 'soldier-4', unitId: 'friendly-0' });
  apply.apply(appearance);
  assert.notEqual(mesh.geometry, geometry); assert.notEqual(mesh.material, material);
  assert.deepEqual([...geometry.attributes.position.array], original);
  const variant = mesh.geometry;
  apply.apply(null); assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
  apply.apply(appearance); assert.equal(mesh.geometry, variant);
  assert.ok([...mesh.geometry.attributes.normal.array].every(Number.isFinite));
  variant.dispose(); geometry.dispose(); mesh.material.dispose(); material.dispose();
});
