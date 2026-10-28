import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { configureNraTexture, attachNraHelmet } from '../src/nra-character.js';

const base = new URL('../public/assets/game/nra-88/', import.meta.url);
test('eye textures repeat outside the first UV tile instead of clamping the iris to white', () => {
  const texture = configureNraTexture(new THREE.Texture(), 'eye');
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
  const uv = texture.transformUv(new THREE.Vector2(1.5, .5));
  assert.ok(Math.abs(uv.x - .5) < 1e-8 && Math.abs(uv.y - .5) < 1e-8);
});
test('hand textures repeat their negative U coordinates rather than smearing the left image edge into colored bands', () => {
  const texture = configureNraTexture(new THREE.Texture(), 'hand');
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
  const uv = texture.transformUv(new THREE.Vector2(-.25, .75));
  assert.ok(Math.abs(uv.x - .75) < 1e-8);
});
test('promoted NRA subset retains explicit permission basis and matches every published file hash', () => {
  const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
  assert.equal(source.permission.basis, 'user-reported-author-phone-consent');
  assert.equal(source.permission.isCC0, false);
  assert.equal(source.evaluation.status, 'prototype-friendly-force');
  assert.equal(source.files.length, 23);
  assert.deepEqual(readdirSync(base).sort(), ['source.json', ...source.files.map(file => file.file)].sort());
  for (const file of source.files) {
    assert.match(file.file, /^[\w-]+\.(?:fbx|json|jpg|png|txt)$/);
    const bytes = readFileSync(new URL(file.file, base));
    assert.equal(bytes.length, file.bytes, file.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
  }
});

test('helmet follows the real head joint using recorded source-prefab transforms', () => {
  const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
  const head = new THREE.Bone(), helmet = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  helmet.add(mesh);
  attachNraHelmet(head, helmet, new THREE.Texture(), source.helmet);
  assert.equal(helmet.parent, head);
  assert.deepEqual(helmet.position.toArray(), source.helmet.position);
  const before = helmet.getWorldPosition(new THREE.Vector3());
  head.position.x += 3; head.updateMatrixWorld(true);
  assert.ok(Math.abs(helmet.getWorldPosition(new THREE.Vector3()).x - before.x - 3) < 1e-8);
  assert.equal(mesh.castShadow, true);
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
