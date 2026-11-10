import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingFire } from '../src/building-fire.js';

const buildings = [
  { id: 'town', x: -10, z: 0, w: 8, d: 14, height: 6.4, ruined: true },
  { id: 'nanjing', x: 10, z: 0, width: 10, depth: 8, height: 6.25, damaged: true },
  { id: 'near-outskirts', x: 0, z: 20, w: 14, d: 12, height: 4.7, near: true, ruined: true },
  { id: 'far-outskirts', x: 0, z: 40, w: 14, d: 12, height: 4.7, near: false, ruined: true },
];
const capture = scene => scene.children.map(mesh => ({
  matrix: [...mesh.instanceMatrix.array],
  attributes: ['plumeOpacity', 'plumeKind', 'plumeSeed'].map(key => [...mesh.geometry.attributes[key].array]),
}));

test('fire beds occupy the exposed interior or actual capped outskirts roof, not surviving roof tiles', () => {
  const fire = createBuildingFire(new THREE.Scene(), buildings);
  for (const [index, source] of fire.sources.entries()) {
    const building = buildings[index];
    assert.equal(source.sites.length, 3);
    for (const site of source.sites) {
      assert.ok(Math.abs(site.x - building.x) < (building.width ?? building.w) / 2 - .3);
      assert.ok(Math.abs(site.z - building.z) < (building.depth ?? building.d) / 2 - .3);
      assert.equal(site.y, source.y);
      if (building.width) assert.ok(site.x > building.x, 'Nanjing eastern roof opening');
      else assert.ok(site.z > building.z, 'Town/outskirts missing forward roof');
    }
  }
  assert.equal(fire.sources[0].y, .045);
  assert.equal(fire.sources[1].y, .045);
  assert.ok(Math.abs(fire.sources[2].y - 3.825) < 1e-10);
  assert.equal(fire.sources[3].y, .505);
});

test('flames are grounded varied volumes with char beds and embers in one batch', () => {
  const scene = new THREE.Scene(), fire = createBuildingFire(scene, buildings);
  fire.update(12.4);
  const mesh = scene.getObjectByName('damaged-building-flames'), matrix = new THREE.Matrix4();
  const kinds = [...mesh.geometry.attributes.plumeKind.array].slice(0, mesh.count);
  assert.equal(kinds.filter(kind => kind === 1).length, buildings.length * 3);
  assert.equal(kinds.filter(kind => kind === 2).length, buildings.length * 6);
  const widths = new Set(), heights = new Set(), headings = new Set();
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, matrix);
    if (kinds[index] !== 0) continue;
    const site = fire.sources[Math.floor(index / 27)].sites[Math.floor(index % 27 / 7)];
    const height = new THREE.Vector3().setFromMatrixColumn(matrix, 1).length();
    assert.ok(Math.abs(matrix.elements[13] - height / 2 - site.y - .015) < 1e-5);
    widths.add(new THREE.Vector3().setFromMatrixColumn(matrix, 0).length().toFixed(2));
    heights.add(height.toFixed(2));
    headings.add(Math.atan2(matrix.elements[8], matrix.elements[10]).toFixed(2));
  }
  assert.ok(widths.size > 10 && heights.size > 10 && headings.size > 10);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.ok(mesh.geometry.attributes.position.count > 30, 'curved, subdivided flame shells');
  assert.equal(fire.snapshot.drawCalls, 2);
});

test('simulation time is deterministic, finite and bounded even for long sessions', () => {
  const scene = new THREE.Scene(), fire = createBuildingFire(scene, buildings);
  fire.update(13.5);
  const first = capture(scene);
  fire.update(14); assert.notDeepEqual(capture(scene), first);
  fire.update(13.5); assert.deepEqual(capture(scene), first);
  for (const time of [-100, 0, 1e9, Number.MAX_VALUE]) {
    fire.update(time);
    for (const mesh of scene.children) {
      assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
      assert.ok([...mesh.geometry.attributes.plumeOpacity.array].every(value => value >= 0 && value <= 1));
      assert.ok(Number.isFinite(mesh.material.uniforms.time.value));
    }
  }
  for (const time of [NaN, Infinity, -Infinity, undefined]) assert.throws(() => fire.update(time), RangeError);
});

test('low quality retains three beds, six anchored tongues and an ember; smoke can be disabled independently', () => {
  const scene = new THREE.Scene(), fire = createBuildingFire(scene, buildings);
  fire.update(8, { low: true, smoke: false });
  assert.deepEqual(fire.snapshot, { sources: 4, smoke: 0, flames: 40, drawCalls: 1 });
  assert.equal(scene.getObjectByName('damaged-building-smoke').visible, false);
  fire.update(8, { low: true });
  assert.deepEqual(fire.snapshot, { sources: 4, smoke: 16, flames: 40, drawCalls: 2 });
});

test('intact or absent buildings produce no active draw calls', () => {
  const scene = new THREE.Scene(), fire = createBuildingFire(scene, [{ x: 0, z: 0 }]);
  fire.update(3);
  assert.deepEqual(fire.snapshot, { sources: 0, smoke: 0, flames: 0, drawCalls: 0 });
});
