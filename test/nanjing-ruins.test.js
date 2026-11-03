import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';

test('ruined houses retain supported roof fragments and beams, and damage marks stay on surviving walls', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const impacts = scene.children.find(mesh => mesh.userData.nanjingFeature === 'masonry-shell-pocks');
  assert.ok(impacts);
  const ray = new THREE.Raycaster(), point = new THREE.Vector3();
  let roofCount = 0, beamCount = 0, markVertices = 0;
  for (const home of world.landmarks.residentialBuildings.filter(home => home.damaged)) {
    const meshes = world.solids.filter(mesh => mesh.userData.residentialId === home.id);
    const inverse = new THREE.Matrix4().makeRotationY(-home.facing * Math.PI / 2)
      .multiply(new THREE.Matrix4().makeTranslation(-home.x, 0, -home.z));
    const width = home.facing % 2 ? home.depth : home.width;
    const depth = home.facing % 2 ? home.width : home.depth;
    const walls = meshes.filter(mesh => mesh.userData.nanjingFeature === 'residential-house');
    const roofs = meshes.filter(mesh => mesh.userData.nanjingFeature === 'residential-tile-roof');
    assert.equal(roofs.length, 1, home.id);
    for (const roof of roofs) {
      const positions = roof.geometry.attributes.position;
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(roof.matrixWorld).applyMatrix4(inverse);
        assert.ok(point.x <= .00001, `${home.id}: tiles cannot survive over the collapsed half`);
      }
      roofCount++;
    }
    const gables = meshes.filter(mesh => mesh.userData.nanjingFeature === 'residential-roof-core');
    assert.equal(gables.length, 2, 'only the supported end gables remain above a ruined attic');
    for (const gable of gables) assert.ok(Math.abs(gable.geometry.parameters.options.depth - .24) < .00001);
    for (const beam of meshes.filter(mesh => mesh.userData.nanjingFeature === 'broken-roof-beam')) {
      const anchor = new THREE.Vector3(-.5, 0, 0).applyMatrix4(beam.matrixWorld);
      ray.set(anchor.clone().add(new THREE.Vector3(0, .35, 0)), new THREE.Vector3(0, -1, 0));
      ray.far = .5;
      assert.ok(ray.intersectObjects(walls, false).length, `${home.id}: a hanging beam must attach to a standing wall`);
      beamCount++;
    }
    const positions = impacts.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(impacts.matrixWorld).applyMatrix4(inverse);
      if (Math.abs(point.z + depth / 2 + .128) > .003 || Math.abs(point.x) > width / 2) continue;
      const wallHeight = point.x > .65 ? 1.05 : home.floors * 2.7;
      assert.ok(point.y >= -.00001 && point.y <= wallHeight + .00001, `${home.id}: damage floats above a broken wall`);
      assert.ok(Math.abs(point.x) >= .65 || point.y >= 2.2, `${home.id}: damage floats in the doorway`);
      markVertices++;
    }
  }
  assert.ok(roofCount > 20 && beamCount === roofCount * 5 && markVertices > 1000,
    'check actual scene geometry across the damaged neighborhood, not an isolated proxy');
});
