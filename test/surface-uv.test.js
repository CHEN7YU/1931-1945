import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeSurfaceGeometry } from '../src/surface-uv.js';
import { createRoofGeometry } from '../src/battlefield.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} should equal ${b}`);
function object(geometry, surface, meters = 2) {
  const material = new THREE.MeshStandardMaterial();
  material.userData = { surface, metersPerTile: meters };
  return new THREE.Mesh(geometry, material);
}
function bake(mesh) {
  mesh.updateMatrixWorld(true);
  return bakeSurfaceGeometry(mesh);
}
test('paving retains world-metric UVs, including continuity between separate pieces', () => {
  for (const x of [0, 3, 12]) {
    const mesh = object(new THREE.BoxGeometry(1, 1, 1), 'paving', 3);
    mesh.scale.set(6, .035, 12);
    mesh.position.set(x, 0, 40);
    const geometry = bake(mesh), p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) if (n.getY(i) > .9) {
      near(uv.getX(i), p.getX(i) / 3);
      near(uv.getY(i), p.getZ(i) / 3);
    }
  }
});
test('brick gables use the same world density and phase as the wall below', () => {
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([-4, 0, 0, 4, 0, 0, 0, 2, 0], 3));
  gable.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 8 / 3, 0, 4 / 3, 2 / 3], 2));
  gable.computeVertexNormals();
  for (const angle of [0, Math.PI]) {
    const mesh = object(gable, 'brick', 2.4);
    mesh.position.set(12, 6, 30);
    mesh.rotation.y = angle;
    const result = bake(mesh), p = result.attributes.position, uv = result.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      near(uv.getX(i), p.getX(i) / 2.4);
      near(uv.getY(i), p.getY(i) / 2.4);
    }
  }
});
test('timber grain follows long box axes and does not change when the object rotates', () => {
  for (const axis of ['x', 'y', 'z']) {
    const mesh = object(new THREE.BoxGeometry(1, 1, 1), 'timber');
    mesh.scale.set(.12, .12, .12);
    mesh.scale[axis] = 4;
    const before = bake(mesh).attributes.uv.array.slice();
    mesh.rotation.set(.3, 1.1, -.6);
    mesh.position.set(50, 3, -40);
    const result = bake(mesh), uv = result.attributes.uv, normal = mesh.geometry.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      near(uv.getX(i), before[i * 2]);
      near(uv.getY(i), before[i * 2 + 1]);
      if (Math.abs(normal.getComponent(i, { x: 0, y: 1, z: 2 }[axis])) < .5) {
        near(uv.getY(i), mesh.geometry.attributes.position.getComponent(i, { x: 0, y: 1, z: 2 }[axis]) * 4 / 2);
      }
    }
  }
});
test('barrels and thin beams unwrap their circumference without facet folds', () => {
  for (const [radius, length, angle] of [[.33, 1, 0], [.055, 4, .7]]) {
    const mesh = object(new THREE.CylinderGeometry(1, 1, 1, 10), 'timber');
    mesh.scale.set(radius, length, radius);
    mesh.rotation.z = angle;
    const geometry = bake(mesh), uv = geometry.attributes.uv, p = mesh.geometry.attributes.position;
    for (let i = 0; i < 22; i++) {
      near(uv.getX(i), mesh.geometry.attributes.uv.getX(i) * 2 * Math.PI * radius / 2);
      near(uv.getY(i), p.getY(i) * length / 2);
    }
  }
});
test('roof UV lengths match the curved slope and depth, with continuous strip seams', () => {
  for (const [w, d, rise] of [[8.8, 14.8, 1.65], [25.6, 12.8, 2.6]]) {
    const geometry = createRoofGeometry(w, d, rise, 2.5);
    const p = geometry.attributes.position, uv = geometry.attributes.uv;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 6) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 2);
      near(uv.getX(i + 2) - uv.getX(i), a.distanceTo(b) / 2.5);
      near(uv.getY(i + 1) - uv.getY(i), d / 2.5);
      if (i + 6 < p.count) near(uv.getX(i + 2), uv.getX(i + 6));
    }
  }
});
test('projection leaves source geometry, authored UVs and collision positions intact', () => {
  const mesh = object(new THREE.BoxGeometry(1, 1, 1), 'timber');
  mesh.scale.set(4, .1, 2);
  const originalUV = mesh.geometry.attributes.uv.array.slice();
  const originalPositions = mesh.geometry.attributes.position.array.slice();
  const result = bake(mesh);
  assert.deepEqual(mesh.geometry.attributes.uv.array, originalUV);
  assert.deepEqual(mesh.geometry.attributes.position.array, originalPositions);
  const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  assert.deepEqual(result.attributes.position.array, transformed.attributes.position.array);
  assert.deepEqual(result.attributes.normal.array, transformed.attributes.normal.array);
  mesh.userData.keepUV = true;
  assert.deepEqual(bake(mesh).attributes.uv.array, originalUV);
  delete mesh.userData.keepUV;
  delete mesh.material.userData.metersPerTile;
  assert.deepEqual(bake(mesh).attributes.uv.array, originalUV);
});
test('invalid tile sizes fail explicitly', () => {
  for (const size of [0, -1, NaN, Infinity]) {
    assert.throws(() => bake(object(new THREE.BoxGeometry(), 'brick', size)), /positive and finite/);
  }
});
