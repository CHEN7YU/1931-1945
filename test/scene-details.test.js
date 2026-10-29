import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeTownLayout } from '../src/town-layout.js';
import { streetGrimePatches, grimePatchGeometry, sandbagGeometry, sandbagCollisionProxy } from '../src/scene-details.js';

test('local grime is clipped to actual street-facing wall pieces, never across apertures', () => {
  const town = makeTownLayout(), before = structuredClone(town);
  const patches = streetGrimePatches(town);
  assert.ok(patches.length > 10 && patches.length < 60);
  assert.deepEqual(new Set(patches.map(patch => patch.buildingId)), new Set(['west-0', 'east-0', 'courtyard-shop']));
  for (const patch of patches) {
    const wall = town.pieces.find(piece => piece.id === patch.wallId);
    assert.ok(patch.w > 0 && patch.h > 0);
    assert.ok(patch.z - patch.w / 2 >= wall.z - wall.d / 2 - 1e-8);
    assert.ok(patch.z + patch.w / 2 <= wall.z + wall.d / 2 + 1e-8);
    assert.ok(patch.y - patch.h / 2 >= wall.y - wall.h / 2 - 1e-8);
    assert.ok(patch.y + patch.h / 2 <= wall.y + wall.h / 2 + 1e-8);
    assert.ok(Math.abs(patch.x - wall.x - patch.normal * (wall.w / 2 + .006)) < 1e-8);
    assert.ok(!patch.wallId.includes('partition'));
    const geometry = grimePatchGeometry(patch), uv = geometry.attributes.uv;
    const column = patch.stain.cell % 2, row = Math.floor(patch.stain.cell / 2);
    for (let i = 0; i < uv.count; i++) {
      assert.ok(uv.getX(i) > column * .5 && uv.getX(i) < (column + 1) * .5);
      assert.ok(uv.getY(i) > (1 - row) * .5 && uv.getY(i) < (2 - row) * .5);
    }
    geometry.dispose();
  }
  assert.deepEqual(town, before);
  assert.deepEqual(streetGrimePatches(town), patches, 'detail placement must not consume the world random stream');
});

test('clipped mask UVs retain their original phase on both street-facing orientations', () => {
  const patches = streetGrimePatches(makeTownLayout());
  for (const patch of patches) {
    const geometry = grimePatchGeometry(patch), p = geometry.attributes.position, uv = geometry.attributes.uv;
    const inset = 2 / 1024, span = .5 - 2 * inset;
    for (let i = 0; i < p.count; i++) {
      const z = patch.z - patch.normal * p.getX(i);
      const expected = (patch.stain.cell % 2) * .5 + inset + ((z - patch.stain.z) / patch.stain.w + .5) * span;
      assert.ok(Math.abs(uv.getX(i) - expected) < 1e-6);
    }
    geometry.dispose();
  }
});

test('shared sandbag geometry has smooth body, gathered ends and seam colors inside the old collision envelope', () => {
  const geometry = sandbagGeometry(), p = geometry.attributes.position;
  assert.ok(p.count / 3 <= 1000, 'keep the shared pilot model below 1000 triangles');
  assert.ok(p.count / 3 > 400, 'not the original low-poly ellipsoid');
  const point = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i);
    assert.ok(point.length() <= 1.00001);
    assert.ok(Number.isFinite(geometry.attributes.normal.getX(i)));
    assert.ok(Number.isFinite(geometry.attributes.uv.getY(i)));
  }
  assert.ok(geometry.attributes.color.array.some(value => value < .7), 'seams use contrasting cloth color in the same batch');
  assert.ok(geometry.boundingBox.min.y > -.9, 'filled sack has a flattened underside');
  const original = new THREE.SphereGeometry(1, 10, 6);
  original.computeBoundingBox();
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(geometry.boundingBox.min[axis] >= original.boundingBox.min[axis]);
    assert.ok(geometry.boundingBox.max[axis] <= original.boundingBox.max[axis]);
  }
  original.dispose();
  geometry.dispose();
});

test('refined sandbags keep the exact original hidden raycast surface and transform', () => {
  const originalGeometry = new THREE.SphereGeometry(1, 10, 6);
  const material = new THREE.MeshStandardMaterial();
  const original = new THREE.Mesh(originalGeometry, material);
  original.position.set(-.3, .7, 2);
  original.scale.set(.59, .23, .44);
  original.rotation.y = .07;
  original.updateMatrixWorld(true);
  const visual = new THREE.Mesh(sandbagGeometry(), material);
  visual.position.copy(original.position);
  visual.scale.copy(original.scale);
  visual.rotation.copy(original.rotation);
  const proxy = sandbagCollisionProxy(visual, originalGeometry);
  proxy.updateMatrixWorld(true);
  assert.equal(proxy.visible, false);
  assert.equal(proxy.geometry, originalGeometry);
  assert.deepEqual(proxy.matrixWorld.elements, original.matrixWorld.elements);
  const ray = new THREE.Raycaster();
  for (const x of [-.7, -.3, 0, .3]) for (const y of [.5, .7, .85, 1]) {
    ray.set(new THREE.Vector3(x, y, 4), new THREE.Vector3(0, 0, -1));
    assert.deepEqual(ray.intersectObject(proxy).map(hit => hit.distance), ray.intersectObject(original).map(hit => hit.distance));
  }
  originalGeometry.dispose(); visual.geometry.dispose(); material.dispose();
});
