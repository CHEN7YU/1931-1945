import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';

test('Nanjing batches residential rendering but retains collision geometry and all moving actors', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const originals = world.solids.filter(object => object.userData.staticResidential);
  const batches = scene.children.filter(object => object.userData.staticSceneBatch);
  assert.ok(originals.length > 2000, 'verify the real residential meshes rather than a proxy scene');
  assert.ok(batches.length < originals.length / 10, 'material/cell batching must materially reduce submissions');
  assert.equal(world.staticRendering.sources, originals.length);
  assert.equal(world.staticRendering.batches, batches.length);
  assert.ok(originals.every(object => object.parent === null));
  assert.ok(world.flags.every(flag => flag.parent === scene));
  assert.ok(world.ferries.every(boat => boat.parent === scene));
  assert.ok(world.civilians.every(person => person.parent === scene));
  const doors = scene.children.filter(object => object.isInstancedMesh && object.userData.doorIds);
  assert.equal(doors.length, 1, 'dynamic door leaves remain independently animated and pickable');
  const triangles = batches.reduce((sum, mesh) =>
    sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
  assert.equal(triangles, world.staticRendering.triangles);
  for (const home of world.landmarks.residentialBuildings.slice(0, 20)) for (const [dx, dz] of [[.17, .13], [-.21, .19], [.24, -.11]]) {
    const origin = new THREE.Vector3(home.x + dx, home.height + 5, home.z + dz);
    const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
    const source = ray.intersectObjects(originals, false)[0];
    const rendered = ray.intersectObjects(batches, false)[0];
    assert.ok(source && rendered);
    assert.ok(Math.abs(source.distance - rendered.distance) < .00001);
    assert.ok(source.face.normal.clone().transformDirection(source.object.matrixWorld)
      .distanceTo(rendered.face.normal) < .00001);
  }
});
