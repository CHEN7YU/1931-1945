import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { bakeMesh, createStudyPose } from '../uniform-study/skin.js';
import { fitUniformAttachment, refineUniformGeometry, sculptUniformPoint } from '../nra-study/model.js';
import { createRemadeUniformGeometry, fitUniformAttachmentPoint } from '../src/nra-uniform.js';

test('uniform sculpture is local, bounded and leaves skin/helmet construction outside its API', () => {
  for (const part of ['tunic', 'trousers']) {
    let maximum = 0, changed = 0;
    for (let y = .05; y < 1.8; y += .013) for (let angle = 0; angle < Math.PI * 2; angle += .17) {
      const point = new THREE.Vector3(Math.sin(angle) * .17, y, -.035 + Math.cos(angle) * .12);
      const before = point.clone(), after = sculptUniformPoint(point, part), distance = before.distanceTo(after);
      assert.deepEqual(point, before);
      assert.ok(after.toArray().every(Number.isFinite));
      assert.equal(after.y, point.y);
      maximum = Math.max(maximum, distance);
      if (distance > .001) changed++;
    }
    assert.ok(maximum < .015 && maximum > .003, `${part}: ${maximum}`);
    assert.ok(changed > 100);
  }
  const collar = new THREE.Vector3(.05, 1.48, .04);
  assert.ok(collar.distanceTo(sculptUniformPoint(collar, 'tunic')) < 1e-8);
  const puttee = new THREE.Vector3(.10, .25, .02);
  assert.ok(puttee.distanceTo(sculptUniformPoint(puttee, 'trousers')) < 1e-8);
  assert.throws(() => sculptUniformPoint(collar, 'face'), /Unknown/);
});

test('real posed garment gains geometry without mutating source, UVs or material ownership', () => {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const rig = prepareNraRig(model), pose = createStudyPose(model);
  const transform = new THREE.Matrix4().makeScale(.0095, .0095, .0095);
  for (const [name, part] of [['衣服', 'tunic'], ['褲子', 'trousers']]) {
    const source = rig.meshes.find(mesh => mesh.name === name), original = source.geometry.attributes.position.array.slice();
    const baked = bakeMesh(source, transform, new THREE.MeshStandardMaterial(), name, { pose });
    const before = baked.geometry.attributes.position.array.slice();
    assert.deepEqual(baked.geometry.groups, source.geometry.groups);
    const refined = refineUniformGeometry(baked.geometry, part);
    assert.ok(refined.attributes.position.count > baked.geometry.attributes.position.count);
    assert.ok(refined.attributes.position.count < 600000);
    assert.ok([...refined.attributes.position.array, ...refined.attributes.normal.array].every(Number.isFinite));
    for (let index = 0; index < refined.attributes.normal.count; index++) {
      const normal = new THREE.Vector3().fromBufferAttribute(refined.attributes.normal, index);
      assert.ok(Math.abs(normal.length() - 1) < 1e-5);
    }
    assert.equal(refined.attributes.uv.count, refined.attributes.position.count);
    assert.deepEqual(refined.groups.map(group => group.materialIndex),
      (source.geometry.groups.length ? source.geometry.groups : [{ materialIndex: 0 }]).map(group => group.materialIndex));
    assert.equal(refined.groups.reduce((sum, group) => sum + group.count, 0), refined.attributes.position.count);
    assert.deepEqual(baked.geometry.attributes.position.array, before);
    assert.deepEqual(source.geometry.attributes.position.array, original);
    assert.equal(refined.userData.clothSimulation, false);
    refined.dispose(); baked.geometry.dispose(); baked.material.dispose();
  }
  const straps = rig.meshes.find(mesh => mesh.name === '帶子');
  const bakedStraps = bakeMesh(straps, transform, new THREE.MeshStandardMaterial(), 'straps', { pose });
  const originalStraps = bakedStraps.geometry.attributes.position.array.slice();
  const fitted = fitUniformAttachment(bakedStraps.geometry), point = new THREE.Vector3();
  for (let index = 0; index < fitted.attributes.position.count; index++) {
    point.fromBufferAttribute(bakedStraps.geometry.attributes.position, index);
    const expected = sculptUniformPoint(point, 'tunic');
    const actual = new THREE.Vector3().fromBufferAttribute(fitted.attributes.position, index);
    const radial = new THREE.Vector3(point.x, 0, point.z + .035).normalize();
    assert.ok(actual.clone().sub(expected).dot(radial) >= -1e-7);
    assert.ok(actual.distanceTo(expected) <= .001501);
  }
  assert.deepEqual(bakedStraps.geometry.attributes.position.array, originalStraps);
  assert.deepEqual(fitted.groups, bakedStraps.geometry.groups);

  for (const name of ['衣服', '褲子', '帶子', '衣服帶子', '胸繩', '胸章', '臂章']) {
    const source = rig.meshes.find(mesh => mesh.name === name), originalGeometry = source.geometry;
    const originalPoints = originalGeometry.attributes.position.array.slice();
    const remade = createRemadeUniformGeometry(source, pose);
    assert.equal(originalGeometry.userData.uniformVariant, undefined);
    assert.equal(remade.userData.uniformVariant, 'B');
    assert.deepEqual(remade.attributes.skinIndex.array, originalGeometry.attributes.skinIndex.array);
    assert.deepEqual(remade.attributes.skinWeight.array, originalGeometry.attributes.skinWeight.array);
    assert.deepEqual(remade.attributes.uv.array, originalGeometry.attributes.uv.array);
    assert.deepEqual(remade.groups, originalGeometry.groups);
    const referenceTransform = transform.clone().setPosition(0, .00003, 0);
    const before = bakeMesh(source, referenceTransform, new THREE.MeshStandardMaterial(), name, { pose });
    source.geometry = remade;
    const after = bakeMesh(source, referenceTransform, before.material, name, { pose });
    source.geometry = originalGeometry;
    for (let index = 0; index < remade.attributes.position.count; index += 31) {
      const reference = new THREE.Vector3().fromBufferAttribute(before.geometry.attributes.position, index);
      const expected = name === '衣服' || name === '褲子'
        ? sculptUniformPoint(reference, name === '衣服' ? 'tunic' : 'trousers') : fitUniformAttachmentPoint(reference);
      const actual = new THREE.Vector3().fromBufferAttribute(after.geometry.attributes.position, index);
      assert.ok(actual.distanceTo(expected) < 1e-6, `${name}:${index}: runtime bind geometry must reproduce approved reference sculpture`);
    }
    assert.deepEqual(originalGeometry.attributes.position.array, originalPoints);
    remade.dispose(); before.geometry.dispose(); after.geometry.dispose(); before.material.dispose();
  }
});
