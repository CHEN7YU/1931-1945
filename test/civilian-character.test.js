import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { civilianAppearanceProfile, createCivilianCharacterFactory, updateCivilianAppearance } from '../src/civilian-character.js';
import { updateFerryVisibility, restoreFerryPassenger } from '../src/nanjing-ferry.js';

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
  assert.equal(person.civilianSkin.mesh.material, factory.simpleMaterial);
  assert.equal(person.civilianSkin.mesh.material.normalMap, null);
  assert.equal(person.civilianSkin.skeleton, skeleton);
  assert.equal(person.civilianSkin.mesh.castShadow, false);
  boat.position.x = 0;
  updateCivilianAppearance([person], camera, 'low');
  assert.equal(person.civilianSkin.level, 'near');
  assert.ok(person.civilianArms.every(arm => arm.rotation.x === .25));
  assert.ok(person.civilianSkin.joints.leftElbow.rotation.x > 1);
});

test('surface relief uses one shared linear normal atlas and never increases the coarse material shader cost', () => {
  const factory = createCivilianCharacterFactory(), normal = factory.material.normalMap;
  assert.equal(normal.image.width, 256);
  assert.equal(normal.colorSpace, THREE.NoColorSpace);
  assert.equal(factory.simpleMaterial.normalMap, null);
  assert.equal(factory.simpleMaterial.map, factory.material.map);
  assert.equal(factory.simpleMaterial.roughnessMap, factory.material.roughnessMap);
  let clothRelief = 0, skinRelief = 0;
  const data = normal.image.data;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const offset = (y * 256 + x) * 4;
    const nx = data[offset] / 255 * 2 - 1, ny = data[offset + 1] / 255 * 2 - 1;
    const nz = data[offset + 2] / 255 * 2 - 1;
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < .015);
    if (x < 128) clothRelief += Math.abs(nx) + Math.abs(ny);
    else if (x < 192) skinRelief += Math.abs(nx) + Math.abs(ny);
  }
  assert.ok(clothRelief > skinRelief * 5, 'skin must not inherit the coarse cloth weave');
});

test('dense crowds cap detailed surfaces by preset and favor nearby people without changing their skeletons or geometry', () => {
  const factory = createCivilianCharacterFactory(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const people = Array.from({ length: 60 }, (_, index) => {
    const person = factory.create(index, 'adult', 'man', 'none');
    person.position.set(0, 0, -2 - index * .08); scene.add(person);
    return person;
  });
  for (const [preset, limit] of [['low', 8], ['medium', 12], ['high', 16]]) {
    updateCivilianAppearance(people, camera, preset);
    const detailed = people.filter(person => person.civilianSkin.mesh.material.normalMap);
    assert.equal(detailed.length, limit);
    assert.deepEqual(detailed, people.slice(0, limit));
    assert.ok(people.every(person => person.civilianSkin.level === 'near'));
    assert.equal(new Set(detailed.map(person => person.civilianSkin.mesh.material)).size, 1);
    updateCivilianAppearance([...people].reverse(), camera, preset);
    assert.deepEqual(people.filter(person => person.civilianSkin.mesh.material.normalMap), detailed);
  }
  const person = people[0], skin = person.civilianSkin, geometry = skin.mesh.geometry, skeleton = skin.skeleton;
  person.position.z = -8.5; updateCivilianAppearance([person], camera, 'low');
  assert.equal(skin.surfaceLevel, 'detailed');
  person.position.z = -9.1; updateCivilianAppearance([person], camera, 'low');
  assert.equal(skin.surfaceLevel, 'simple');
  person.position.z = -8; updateCivilianAppearance([person], camera, 'low');
  assert.equal(skin.surfaceLevel, 'simple');
  person.position.z = -6.5; updateCivilianAppearance([person], camera, 'low');
  assert.equal(skin.surfaceLevel, 'detailed');
  assert.equal(skin.mesh.geometry, geometry);
  assert.equal(skin.skeleton, skeleton);
});

test('surface LOD respects private ferry fades and restores the selected shared material without mutating shore civilians', () => {
  const factory = createCivilianCharacterFactory(), scene = new THREE.Scene(), ferry = new THREE.Group();
  const person = factory.create(0, 'adult', 'woman', 'none'), camera = new THREE.PerspectiveCamera();
  scene.add(ferry); ferry.add(person); ferry.position.x = -128;
  camera.position.set(-128, 1, -3);
  updateCivilianAppearance([person], camera, 'low');
  updateFerryVisibility(ferry);
  const faded = person.civilianSkin.mesh.material;
  assert.equal(faded.opacity, .5);
  camera.position.x = 0;
  updateCivilianAppearance([person], camera, 'low');
  assert.equal(person.civilianSkin.mesh.material, faded);
  assert.equal(faded.normalMap, null);
  assert.equal(faded.opacity, .5);
  assert.equal(faded.transparent, true);
  assert.equal(faded.depthWrite, false);
  assert.equal(factory.material.opacity, 1);
  assert.equal(factory.simpleMaterial.opacity, 1);
  let disposed = 0; faded.addEventListener('dispose', () => disposed++);
  restoreFerryPassenger(person);
  assert.equal(disposed, 1);
  assert.equal(person.civilianSkin.mesh.material, factory.simpleMaterial);
  assert.equal(factory.simpleMaterial.transparent, false);
});

test('all carrying variants retain the existing detail budget and share cloth, skin, hair and shoe surfaces', () => {
  const factory = createCivilianCharacterFactory();
  const { map, roughnessMap } = factory.material;
  assert.equal(roughnessMap.image.width, 256);
  assert.equal(map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(roughnessMap.colorSpace, THREE.NoColorSpace);
  const roughnessAt = x => roughnessMap.image.data[(30 * 256 + x) * 4 + 1];
  assert.ok(roughnessAt(20) > roughnessAt(160), 'cloth must remain more matte than skin');
  for (let index = 0; index < 30; index++) for (const age of ['adult', 'elderly', 'child'])
    for (const sex of ['man', 'woman']) for (const carrying of ['none', 'luggage', 'child']) {
      const person = factory.create(index, age, sex, carrying);
      const { near, far } = person.civilianSkin.geometry;
      assert.ok(near.index.count / 3 < 14000, person.civilianSkin.profile.key);
      assert.ok(far.index.count < near.index.count * .35);
      assert.equal(person.civilianSkin.mesh.material, factory.material);
      assert.deepEqual(person.userData.civilianDetail.materialRegions, ['cloth', 'skin', 'hair', 'leather']);
    }
  assert.equal(factory.templates.size, 54);
  for (const { near } of factory.templates.values()) {
    for (const name of ['position', 'normal', 'color', 'uv', 'skinWeight']) {
      assert.ok(near.attributes[name].array.every(Number.isFinite), name);
    }
    const regions = new Set();
    for (let vertex = 0; vertex < near.attributes.uv.count; vertex++) {
      const u = near.attributes.uv.getX(vertex);
      regions.add(u < .5 ? 'cloth' : u < .75 ? 'skin' : u < .875 ? 'hair' : 'leather');
    }
    assert.equal(regions.size, 4);
  }
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

test('detailed shoe insteps meet the trouser ankle instead of leaving a floating foot gap', () => {
  const person = createCivilianCharacterFactory().create(3, 'adult', 'man', 'none');
  const { skeleton, geometry } = person.civilianSkin;
  const positions = geometry.near.attributes.position, joints = geometry.near.attributes.skinIndex;
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    const joint = skeleton.bones.findIndex(bone => bone.name === `${side}Foot`);
    let ankle = false;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (joints.getX(vertex) === joint && positions.getY(vertex) >= .12 &&
        Math.abs(positions.getX(vertex) - sign * .095) < .045 && Math.abs(positions.getZ(vertex)) < .045)
        ankle = true;
    }
    assert.ok(ankle, side);
  }
});
