import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDistantPoseGeometry, createLowMemoryPoseGeometry, prepareDistantGeometry, useDistantPose } from '../src/distant-pose-lod.js';

test('coarse poses reduce real triangles while retaining original attribute tuples and independent buffers', async () => {
  const source = new THREE.SphereGeometry(1, 64, 32);
  source.clearGroups(); source.computeBoundingBox(); source.computeBoundingSphere();
  source.setAttribute('nraSkinRegion', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count).fill(1), 1));
  source.setAttribute('nraUniformUv', source.attributes.uv.clone());
  source.setAttribute('nraSkinTint', new THREE.InstancedBufferAttribute(new Float32Array([1, .9, .8, .7, .6, .5]), 3));
  source.setAttribute('nraUniformVariant', new THREE.InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  const before = JSON.stringify(source.toJSON()), coarse = await createDistantPoseGeometry(source);
  assert.ok(coarse.index.count < source.index.count * .6);
  assert.ok(coarse.attributes.position.count < source.attributes.position.count);
  assert.ok(coarse.userData.distantPoseLod.error <= .005001);
  const names = Object.keys(source.attributes).filter(name => !source.attributes[name].isInstancedBufferAttribute);
  const key = (geometry, vertex) => names.flatMap(name => {
    const attribute = geometry.attributes[name];
    return Array.from(attribute.array.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize));
  }).join(',');
  const original = new Set(Array.from({ length: source.attributes.position.count }, (_, vertex) => key(source, vertex)));
  for (let vertex = 0; vertex < coarse.attributes.position.count; vertex++) assert.ok(original.has(key(coarse, vertex)));
  assert.ok(coarse.index.array.every(index => index < coarse.attributes.position.count));
  for (const [name, attribute] of Object.entries(coarse.attributes)) {
    assert.notEqual(attribute.array.buffer, source.attributes[name].array.buffer);
    if (attribute.isInstancedBufferAttribute) assert.deepEqual(attribute.array, source.attributes[name].array);
  }
  coarse.attributes.nraSkinTint.setX(0, .1);
  assert.equal(JSON.stringify(source.toJSON()), before);
  assert.deepEqual(coarse.boundingBox, source.boundingBox);
  assert.deepEqual(coarse.boundingSphere, source.boundingSphere);
  coarse.dispose(); source.dispose();
});

test('distance hysteresis and effective FOV restore original detail immediately on approach and zoom', () => {
  const camera = new THREE.PerspectiveCamera(72);
  assert.equal(useDistantPose(camera, 32, false, 'high'), true);
  assert.equal(useDistantPose(camera, 30, false, 'high'), false);
  assert.equal(useDistantPose(camera, 30, true, 'high'), true);
  assert.equal(useDistantPose(camera, 24, true, 'high'), false);
  assert.equal(useDistantPose(camera, 23, false, 'low'), true);
  assert.equal(useDistantPose(camera, 23, false, 'high'), false);
  camera.fov = 18;
  assert.equal(useDistantPose(camera, 60, true, 'high'), false);
  camera.fov = 72; camera.zoom = 4;
  assert.equal(useDistantPose(camera, 60, true, 'high'), false);
  assert.equal(useDistantPose(camera, 200, false, 'high'), true);
});

test('resident low-memory geometry preserves every morph through the exact same source-vertex remap', async () => {
  await prepareDistantGeometry();
  const source = new THREE.SphereGeometry(1, 64, 32); source.clearGroups();
  source.morphAttributes.position = [source.attributes.position.clone(), source.attributes.position.clone()];
  source.morphAttributes.normal = [source.attributes.normal.clone(), source.attributes.normal.clone()];
  for (let i = 0; i < source.attributes.position.count; i++) {
    source.morphAttributes.position[0].setY(i, source.attributes.position.getY(i) + .1);
    source.morphAttributes.position[1].setZ(i, source.attributes.position.getZ(i) - .2);
  }
  const snapshot = JSON.stringify(source.toJSON()), geometry = createLowMemoryPoseGeometry(source);
  const sourceTuples = new Set(Array.from({ length: source.attributes.position.count }, (_, vertex) => {
    return [source.attributes.position, ...source.morphAttributes.position, ...source.morphAttributes.normal]
      .flatMap(attribute => [...attribute.array.subarray(vertex * 3, vertex * 3 + 3)]).join(',');
  }));
  assert.ok(geometry.index.count < source.index.count * .6);
  assert.equal(geometry.morphAttributes.position.length, 2);
  for (let vertex = 0; vertex < geometry.attributes.position.count; vertex++) {
    const tuple = [geometry.attributes.position, ...geometry.morphAttributes.position, ...geometry.morphAttributes.normal]
      .flatMap(attribute => [...attribute.array.subarray(vertex * 3, vertex * 3 + 3)]).join(',');
    assert.ok(sourceTuples.has(tuple), 'base and every animation sample retain the same original vertex');
  }
  const bytes = value => [...Object.values(value.attributes), ...Object.values(value.morphAttributes).flat()]
    .reduce((sum, attribute) => sum + attribute.array.byteLength, value.index.array.byteLength);
  assert.ok(bytes(geometry) < bytes(source) * .6);
  assert.equal(JSON.stringify(source.toJSON()), snapshot);
  geometry.dispose(); source.dispose();
});

test('invalid or unmerged geometry is rejected explicitly instead of producing an empty successful LOD', async () => {
  const grouped = new THREE.BoxGeometry();
  await assert.rejects(createDistantPoseGeometry(grouped), /merged Float32 triangle pose/);
  const empty = new THREE.BufferGeometry();
  empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  await assert.rejects(createDistantPoseGeometry(empty), /complete triangles/);
  grouped.dispose(); empty.dispose();
});
