import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNraAppearance, nraUniformForSquad, sculptNraPoint, createNraAppearanceApplicator, NRA_FACE_NAME } from '../src/nra-appearance.js';
import { sihangRetreatFormation } from '../src/sihang-roster.js';

test('five whole squad slots use each uniform and replacement generations retain their squad style', () => {
  const squads = Array.from({ length: 10 }, (_, index) => ({ index, id: `friendly-${index}` }));
  assert.deepEqual(squads.map(squad => nraUniformForSquad(squad.index)), ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B']);
  for (const formation of squads) for (let generation = 0; generation < 3; generation++) {
    const members = Array.from({ length: 10 }, (_, member) => createNraAppearance({
      id: `${formation.id}:${generation}:${member}`, unitId: formation.id, formation,
    }));
    assert.ok(members.every(member => member.uniform === nraUniformForSquad(formation.index)));
  }
  for (const invalid of [-1, 10, 4.5, NaN, undefined]) assert.throws(() => nraUniformForSquad(invalid), /valid squad slot/);
});

test('the tenth Sihang AI squad has a valid appearance without widening other campaigns', () => {
  const formation = sihangRetreatFormation(10);
  assert.equal(createNraAppearance({ id: 'soldier-last', unitId: formation.id, formation }).uniform, 'B');
  assert.throws(() => nraUniformForSquad(11, 'sihang'), /valid squad slot/);
  assert.throws(() => nraUniformForSquad(10, 'nanjing'), /valid squad slot/);
});

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

test('detail pool rebind switches complete A/B clothing and restores A without changing either shared source', () => {
  const original = new THREE.BoxGeometry(1, 1, 1), remade = original.clone().translate(.01, 0, 0);
  const materialA = new THREE.MeshStandardMaterial({ color: '#808040' }), materialB = materialA.clone();
  materialB.color.set('#707560');
  const mesh = new THREE.SkinnedMesh(original, materialA); mesh.name = '衣服';
  const apply = createNraAppearanceApplicator([mesh], { geometries: new Map(), materials: new Map() },
    new Map([[mesh.name, { geometry: remade, material: materialB }]]));
  const sourceA = original.attributes.position.array.slice(), sourceB = remade.attributes.position.array.slice();
  const person = { id: 'squad-test', unitId: 'friendly-5', formation: { index: 5 } };
  const appearanceB = { ...createNraAppearance(person), build: 0 };
  apply.apply(appearanceB); assert.equal(mesh.material, materialB);
  assert.deepEqual(mesh.geometry.attributes.position.array, sourceB);
  const cachedB = mesh.geometry;
  const appearanceA = { ...createNraAppearance({ ...person, formation: { index: 0 } }), build: 0 };
  apply.apply(appearanceA); assert.equal(mesh.material, materialA);
  assert.deepEqual(mesh.geometry.attributes.position.array, sourceA);
  apply.apply(appearanceB); assert.equal(mesh.geometry, cachedB);
  apply.apply(null); assert.equal(mesh.geometry, original); assert.equal(mesh.material, materialA);
  assert.deepEqual(original.attributes.position.array, sourceA); assert.deepEqual(remade.attributes.position.array, sourceB);
});
