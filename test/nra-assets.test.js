import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';

const base = new URL('../public/assets/game/nra-88/', import.meta.url);
test('promoted NRA subset retains explicit permission basis and matches every published file hash', () => {
  const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
  assert.equal(source.permission.basis, 'user-reported-author-phone-consent');
  assert.equal(source.permission.isCC0, false);
  assert.equal(source.evaluation.status, 'prototype-one-character');
  assert.equal(source.files.length, 20);
  for (const file of source.files) {
    assert.match(file.file, /^[\w-]+\.(?:fbx|json|jpg|png|txt)$/);
    const bytes = readFileSync(new URL(file.file, base));
    assert.equal(bytes.length, file.bytes, file.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
  }
});

test('actual NRA cleanup preserves all original rest vertices and inverse bind matrices across 14 skins', () => {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const bytes = readFileSync(new URL('character.fbx', base));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  model.updateMatrixWorld(true);
  const before = new Map();
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const points = [], attribute = mesh.geometry.attributes.position;
    for (let index = 0; index < attribute.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(attribute, index);
      mesh.applyBoneTransform(index, point); points.push(mesh.localToWorld(point));
    }
    before.set(mesh, { points, inverse: mesh.skeleton.boneInverses.map(matrix => matrix.toArray()) });
  });
  const rig = prepareNraRig(model);
  let count = 0; model.traverse(node => { if (node.isBone) count++; });
  assert.equal(count, 65); assert.equal(rig.meshes.length, 14);
  for (const side of ['Left', 'Right']) {
    assert.equal(rig.canonical.get(`${side}Hand`).parent, rig.canonical.get(`${side}ForeArm`));
    assert.equal(rig.canonical.get(`${side}ForeArm`).parent, rig.canonical.get(`${side}Arm`));
  }
  for (const mesh of rig.meshes) {
    assert.deepEqual(mesh.skeleton.boneInverses.map(matrix => matrix.toArray()), before.get(mesh).inverse);
    const attribute = mesh.geometry.attributes.position;
    for (let index = 0; index < attribute.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(attribute, index);
      mesh.applyBoneTransform(index, point);
      assert.ok(mesh.localToWorld(point).distanceTo(before.get(mesh).points[index]) < 1e-4, `${mesh.name}/${index}`);
    }
  }
});
