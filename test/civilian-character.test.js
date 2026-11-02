import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { civilianAppearanceProfile, createCivilianCharacterFactory, updateCivilianAppearance } from '../src/civilian-character.js';

test('shared civilian templates cover ages, sexes and clothing with one skinned draw per person', () => {
  const factory = createCivilianCharacterFactory(), people = [];
  for (let index = 0; index < 180; index++) {
    const age = index % 10 === 0 ? 'child' : index % 10 === 1 ? 'elderly' : 'adult';
    const sex = (age === 'adult' ? index : Math.floor(index / 10)) % 2 ? 'man' : 'woman';
    const person = factory.create(index, age, sex, 'none');
    const skin = person.civilianSkin, near = skin.geometry.near, far = skin.geometry.far;
    assert.ok(near.index.count / 3 < 14000);
    assert.ok(far.index.count < near.index.count * .35);
    assert.equal(skin.skeleton.bones.length, 13);
    assert.equal(skin.mesh.material, factory.material);
    assert.equal(person.userData.civilianDetail.renderParts, 1);
    const weights = near.attributes.skinWeight;
    for (let vertex = 0; vertex < weights.count; vertex++)
      assert.ok(Math.abs(weights.getX(vertex) + weights.getY(vertex) - 1) < 1e-6);
    people.push(person);
  }
  assert.ok(factory.templates.size <= 18);
  assert.equal(new Set(people.map(person => person.civilianSkin.geometry.near)).size, factory.templates.size);
  assert.equal(factory.material.map.image.width, 256);
  assert.equal(new Set(people.slice(0, 60).map(person => person.civilianSkin.profile.wardrobe)).size, 3);
  assert.equal(new Set(people.slice(60).map(person => person.civilianSkin.profile.wardrobe)).size, 3);
});

test('LOD switches preserve the same skeleton, identity and cloth colors, including people on moving boats', () => {
  const factory = createCivilianCharacterFactory(), scene = new THREE.Scene(), boat = new THREE.Group();
  const person = factory.create(7, 'adult', 'woman', 'child'), camera = new THREE.PerspectiveCamera();
  person.visible = true; Object.assign(person.userData, { carrying: 'child' });
  scene.add(boat); boat.add(person);
  const skeleton = person.civilianSkin.skeleton;
  camera.position.set(0, 1, 5);
  updateCivilianAppearance([person], camera, 'low');
  assert.equal(person.civilianSkin.level, 'near');
  boat.position.x = 50;
  updateCivilianAppearance([person], camera, 'low');
  assert.equal(person.civilianSkin.level, 'far');
  assert.equal(person.civilianSkin.skeleton, skeleton);
  assert.equal(person.civilianSkin.mesh.castShadow, false);
  boat.position.x = 0;
  updateCivilianAppearance([person], camera, 'low');
  assert.equal(person.civilianSkin.level, 'near');
  assert.ok(person.civilianArms.every(arm => arm.rotation.x === .25));
  assert.ok(person.civilianSkin.joints.leftElbow.rotation.x > 1);
});

test('skinned rest positions remain grounded and knees deform without changing template geometry', () => {
  const factory = createCivilianCharacterFactory();
  for (const [age, sex] of [['adult', 'man'], ['elderly', 'woman'], ['child', 'woman']]) {
    const person = factory.create(3, age, sex, 'none'), scene = new THREE.Scene();
    scene.add(person); scene.updateMatrixWorld(true);
    const { mesh, skeleton } = person.civilianSkin;
    skeleton.update();
    const vertex = new THREE.Vector3(), rest = new THREE.Vector3();
    for (let index = 0; index < mesh.geometry.attributes.position.count; index += 13) {
      rest.fromBufferAttribute(mesh.geometry.attributes.position, index);
      vertex.copy(rest); mesh.applyBoneTransform(index, vertex);
      assert.ok(vertex.distanceTo(rest) < 1e-5, 'bind pose must not double-scale vertices');
    }
    const geometry = mesh.geometry;
    person.civilianLegs[0].rotation.x = .5;
    updateCivilianAppearance([person], new THREE.PerspectiveCamera());
    scene.updateMatrixWorld(true); skeleton.update();
    assert.equal(mesh.geometry, geometry);
    assert.equal(person.civilianSkin.joints.leftKnee.rotation.x, -.425);
  }
  assert.deepEqual(civilianAppearanceProfile(8, 'adult', 'woman', 'none'),
    civilianAppearanceProfile(8, 'adult', 'woman', 'none'));
});
