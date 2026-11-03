import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchStaticScene, staticGeometryBatches, STATIC_BATCH_CELL_SIZE } from '../src/static-scene-batches.js';
import { bakeSurfaceGeometry } from '../src/surface-uv.js';

function tuples(geometries) {
  return geometries.flatMap(geometry => {
    const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
    const names = Object.keys(expanded.attributes).sort();
    return Array.from({ length: expanded.attributes.position.count }, (_, vertex) =>
      names.flatMap(name => {
        const attribute = expanded.attributes[name];
        const bits = new Uint32Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.length);
        return Array.from(bits.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize));
      }).join(','));
  }).sort();
}

test('spatial batches preserve every world-space attribute bit, material and authoritative ray hit', () => {
  const scene = new THREE.Scene(), parent = new THREE.Group();
  parent.position.set(-11, .5, 6); parent.rotation.y = .4; scene.add(parent);
  const material = new THREE.MeshStandardMaterial({ color: 0x777777 });
  material.userData.spatialBatch = true;
  material.userData.metersPerTile = 2;
  const objects = [-90, -15, 55, 120].map((x, index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 3), material);
    mesh.position.set(x, 2, index * 2); mesh.rotation.y = index * .2;
    parent.add(mesh); return mesh;
  });
  scene.updateMatrixWorld(true);
  const before = objects.map(object => bakeSurfaceGeometry(object));
  const matrices = objects.map(object => [...object.matrixWorld.elements]);
  const source = objects.map(object => [...object.geometry.attributes.position.array]);
  const ray = new THREE.Raycaster(new THREE.Vector3().setFromMatrixPosition(objects[0].matrixWorld).add(new THREE.Vector3(0, 10, 0)),
    new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(objects, false)[0];
  const batches = staticGeometryBatches(objects);
  assert.equal(batches.size, 1);
  assert.ok(batches.get(material).size > 2);
  assert.deepEqual(tuples([...batches.get(material).values()].flat()), tuples(before));
  const after = ray.intersectObjects(objects, false)[0];
  assert.equal(after.object, hit.object);
  assert.equal(after.distance, hit.distance);
  assert.deepEqual(after.face.normal, hit.face.normal);
  for (const [index, object] of objects.entries()) {
    assert.equal(object.parent, null);
    assert.deepEqual(object.matrixWorld.elements, matrices[index]);
    assert.deepEqual([...object.geometry.attributes.position.array], source[index]);
  }
});

test('transparent geometry retains one material batch and original submission order', () => {
  const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: .4 });
  material.userData.spatialBatch = true;
  const objects = [-100, 100, -20].map(x => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), material);
    mesh.position.x = x; mesh.updateMatrixWorld(true); return mesh;
  });
  const cells = staticGeometryBatches(objects).get(material);
  assert.deepEqual([...cells.keys()], ['transparent']);
  assert.deepEqual(cells.get('transparent').map(geometry => geometry.attributes.position.getX(0)), [-101.5, 98.5, -21.5]);
});

test('ordinary opaque geometry keeps one batch and its original coplanar triangle order', () => {
  const material = new THREE.MeshStandardMaterial();
  const objects = [-100, 100, -20].map(x => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), material);
    mesh.position.x = x; mesh.updateMatrixWorld(true); return mesh;
  });
  const cells = staticGeometryBatches(objects).get(material);
  assert.deepEqual([...cells.keys()], ['global']);
  assert.deepEqual(cells.get('global').map(geometry => geometry.attributes.position.getX(0)), [-101.5, 98.5, -21.5]);
});

test('a chunk crossing cell boundaries retains its full bounds, while camera and shadow frusta cull independently', () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.spatialBatch = true;
  const objects = [0, -200].map(z => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(STATIC_BATCH_CELL_SIZE * 3, 3, 2), material);
    mesh.position.set(0, 1.5, z); mesh.updateMatrixWorld(true); return mesh;
  });

  const chunks = [...staticGeometryBatches(objects).get(material)].map(([cell, geometries]) => {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = true; mesh.userData.cell = cell; mesh.updateMatrixWorld(true); return mesh;
  });
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 2, 10); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  const shadow = new THREE.OrthographicCamera(-130, 130, 130, -130, .1, 300);
  shadow.position.set(0, 50, -100); shadow.lookAt(0, 0, -100); shadow.updateMatrixWorld(true);
  const frustum = view => new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse));
  assert.equal(frustum(camera).intersectsObject(chunks[0]), true);
  assert.equal(frustum(camera).intersectsObject(chunks[1]), false);
  assert.equal(frustum(shadow).intersectsObject(chunks[1]), true, 'offscreen geometry remains available to the light');
  chunks[0].geometry.computeBoundingBox();
  assert.equal(chunks[0].geometry.boundingBox.getSize(new THREE.Vector3()).x, STATIC_BATCH_CELL_SIZE * 3);
});

test('scene batching preserves authored UVs, colors, flags and original collision meshes without changing shared materials', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
  material.userData.metersPerTile = 2;
  const sources = Array.from({ length: 8 }, (_, index) => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 3), material);
    object.position.set((index % 4) * 4, 2, Math.floor(index / 4) * 5);
    object.rotation.y = index * .2;
    object.castShadow = index < 4; object.receiveShadow = index < 6;
    object.renderOrder = index % 2;
    const uv = object.geometry.attributes.uv;
    for (let vertex = 0; vertex < uv.count; vertex++) uv.setXY(vertex, vertex * .13, vertex * .21);
    scene.add(object); return object;
  });
  scene.updateMatrixWorld(true);
  const original = sources.map(source => bakeSurfaceGeometry(source, { preserveUV: true }));
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  const before = ray.intersectObjects(sources, false)[0];
  const result = batchStaticScene(scene, sources);
  const batches = scene.children.filter(object => object.userData.staticSceneBatch);
  assert.equal(result.sources, sources.length);
  assert.ok(result.batches < sources.length);
  assert.deepEqual(tuples(batches.map(mesh => mesh.geometry)), tuples(original));
  assert.equal(material.userData.spatialBatch, undefined, 'shared material state is not changed to force batching');
  const after = ray.intersectObjects(sources, false)[0];
  assert.equal(after.object, before.object);
  assert.equal(after.distance, before.distance);
  for (const source of sources) {
    source.updateWorldMatrix(true, false);
    assert.equal(source.parent, null);
    const matching = batches.filter(mesh => mesh.castShadow === source.castShadow &&
      mesh.receiveShadow === source.receiveShadow && mesh.renderOrder === source.renderOrder);
    assert.ok(matching.length);
  }
});
