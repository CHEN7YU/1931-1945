import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { accelerateCollisionMesh, createSolidIndex } from '../src/solid-index.js';
import { dryRiverGeometry } from '../src/dry-river.js';
import { craterGeometry } from '../src/war-damage.js';
import { SHELL_CRATERS } from '../src/war-damage-layout.js';

function compare(mesh, ray) {
  const expected = [];
  THREE.Mesh.prototype.raycast.call(mesh, ray, expected);
  const actual = [];
  mesh.raycast(ray, actual);
  const ordered = hits => hits.sort((a, b) => a.distance - b.distance || a.faceIndex - b.faceIndex);
  ordered(expected); ordered(actual);
  assert.equal(actual.length, expected.length, 'all intersections, not just a nearest-hit approximation');
  for (let index = 0; index < actual.length; index++) {
    const a = actual[index], b = expected[index];
    assert.equal(a.object, b.object);
    assert.equal(a.faceIndex, b.faceIndex, 'original triangle identity stays stable');
    assert.equal(a.face.materialIndex, b.face.materialIndex);
    assert.ok(Math.abs(a.distance - b.distance) < 1e-6);
    assert.ok(a.point.distanceTo(b.point) < 1e-6);
    assert.ok(a.face.normal.distanceTo(b.face.normal) < 1e-6);
    if (b.uv) assert.ok(a.uv.distanceTo(b.uv) < 1e-6);
  }
}

test('exact collision BVH preserves real dry river/crater vertices, faces, UV and hit normals', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const geometry of [dryRiverGeometry(), craterGeometry(SHELL_CRATERS[0], .0125)]) {
    const original = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
    const originalIndex = geometry.index?.array.slice() ?? null;
    const mesh = new THREE.Mesh(geometry, material);
    assert.equal(accelerateCollisionMesh(mesh), true);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    for (const transformed of [false, true]) {
      mesh.position.set(transformed ? 4 : 0, transformed ? 1.2 : 0, transformed ? -7 : 0);
      mesh.rotation.set(transformed ? .11 : 0, transformed ? .37 : 0, 0);
      mesh.scale.set(1.1, .9, .8); mesh.updateMatrixWorld(true);
      for (let sample = 0; sample < 80; sample++) {
        const x = min.x + (max.x - min.x) * ((sample * .61803398875 + .031) % 1);
        const z = min.z + (max.z - min.z) * ((sample * .41421356237 + .071) % 1);
        const start = mesh.localToWorld(new THREE.Vector3(x, max.y + 1, z));
        const end = mesh.localToWorld(new THREE.Vector3(x + .013, min.y - 1, z + .009));
        const ray = new THREE.Raycaster(start, end.clone().sub(start).normalize(), 0, start.distanceTo(end));
        compare(mesh, ray);
        ray.near = .001; ray.far = .005;
        compare(mesh, ray);
      }
    }
    for (const [name, array] of Object.entries(original)) assert.deepEqual(geometry.attributes[name].array, array);
    assert.deepEqual(geometry.index?.array ?? null, originalIndex);
  }
});

test('openings, material groups and thin walls retain full raycast semantics', () => {
  const shape = new THREE.Shape().moveTo(-2, -2).lineTo(2, -2).lineTo(2, 2).lineTo(-2, 2);
  const hole = new THREE.Path().moveTo(-.5, -.8).lineTo(-.5, .8).lineTo(.5, .8).lineTo(.5, -.8);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .12, steps: 1, bevelEnabled: true,
    bevelSegments: 8, bevelThickness: .002, bevelSize: .002 });
  const mesh = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
  mesh.updateMatrixWorld(true);
  assert.equal(accelerateCollisionMesh(mesh), true);
  for (const x of [0, -.49, -.51, .49, .51, 1, -1.3]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, .123, 2), new THREE.Vector3(0, 0, -1), 0, 4);
    compare(mesh, ray);
    if (x === 0) assert.equal(ray.intersectObject(mesh).length, 0, 'window stays an actual opening');
  }
});

test('only eligible collision meshes use shared acceleration; moving/deforming special meshes retain their raycasts', () => {
  const geometry = new THREE.SphereGeometry(1, 24, 16), material = new THREE.MeshBasicMaterial();
  const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
  a.updateMatrixWorld(true); b.position.x = 4; b.updateMatrixWorld(true);
  const small = new THREE.Mesh(new THREE.BoxGeometry(), material), door = a.clone();
  door.userData.doorId = 'opening-door';
  const dynamic = new THREE.Mesh(geometry.clone(), material);
  dynamic.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const instanced = new THREE.InstancedMesh(geometry, material, 1), skin = new THREE.SkinnedMesh(geometry, material);
  const custom = a.clone(); custom.raycast = () => {};
  for (const mesh of [small, door, dynamic, instanced, skin, custom]) {
    const raycast = mesh.raycast;
    assert.equal(accelerateCollisionMesh(mesh), false);
    assert.equal(mesh.raycast, raycast);
  }
  const index = createSolidIndex([a, b, small]);
  assert.equal(index.acceleration.meshes, 2);
  assert.ok(index.acceleration.triangles > 512);
  const tree = geometry.boundsTree;
  assert.equal(accelerateCollisionMesh(b), true);
  assert.equal(geometry.boundsTree, tree, 'shared geometry is built only once');
  b.position.set(6, 1, -2); b.updateMatrixWorld(true);
  compare(b, new THREE.Raycaster(new THREE.Vector3(6, 1, 2), new THREE.Vector3(0, 0, -1), 0, 10));
  geometry.dispose();
  assert.equal(geometry.boundsTree, undefined);
});
