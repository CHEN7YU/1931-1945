import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchStaticScene, createStaticSceneBatchRescue, staticGeometryBatches, STATIC_BATCH_CELL_SIZE } from '../src/static-scene-batches.js';
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

function rescueFixture() {
  const scene = new THREE.Scene(), parent = new THREE.Group();
  scene.add(parent);
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const sources = [4, 36, 68, 100].map(x => {
    const geometry = new THREE.BoxGeometry(2, 4, 3).toNonIndexed();
    geometry.translate(x, 2, 4); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.staticSceneBatch = true; mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  });
  return { scene, parent, sources, material };
}
function finishRescue(rescue) {
  for (let frame = 0; frame < 10000 && !rescue.snapshot.ready; frame++)
    rescue.update({ enabled: true, budgetMs: 2, maxChunks: 16 });
  assert.equal(rescue.snapshot.ready, true);
}

test('emergency batches cooperatively reduce submissions with every geometry bit, material and parent visibility intact', () => {
  const { scene, parent, sources, material } = rescueFixture();
  const original = tuples(sources.map(source => source.geometry));
  const rescue = createStaticSceneBatchRescue(scene);
  rescue.update();
  assert.equal(rescue.snapshot.updates, 0, 'ordinary defaults never start a rebuild');
  rescue.update({ enabled: true, maxChunks: 1 });
  assert.equal(rescue.snapshot.copiedBytes, 0, 'one chunk does not synchronously rebuild the scene');
  assert.equal(parent.children.length, 4, 'incomplete geometry never replaces sources');
  finishRescue(rescue);
  const batches = parent.children.filter(mesh => mesh.userData.staticSceneRescue);
  assert.equal(batches.length, 1);
  assert.equal(rescue.snapshot.savedSubmissions, 3);
  assert.deepEqual(tuples(batches.map(mesh => mesh.geometry)), original);
  assert.equal(batches[0].material, material);
  assert.equal(batches[0].material.map, material.map);
  assert.equal(batches[0].castShadow, true);
  assert.equal(batches[0].receiveShadow, true);
  parent.position.set(17, 3, 5); parent.rotation.y = .3;
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(4, 10, 4).applyMatrix4(parent.matrixWorld),
    new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(batches[0]).length, 'the replacement follows its original parent transform');
  assert.ok(batches[0].geometry.boundingBox.equals(
    sources.reduce((box, source) => box.union(source.geometry.boundingBox), new THREE.Box3())));
  parent.visible = false;
  const visible = [];
  scene.traverseVisible(object => visible.push(object));
  assert.equal(visible.includes(batches[0]), false, 'ruin/intact parent toggles still control the replacement');
  rescue.update({ enabled: false });
  assert.deepEqual(new Set(parent.children), new Set(sources));
  assert.equal(parent.visible, false, 'restoring does not override hierarchy visibility');
  rescue.update({ enabled: true });
  assert.equal(parent.children.length, 1);
  rescue.dispose();
  assert.deepEqual(new Set(parent.children), new Set(sources));
  assert.equal(rescue.snapshot.enabled, false);
});

test('authoritative collision meshes, ordinary meshes, doors, transparent meshes and different parents are never merged together', () => {
  const { scene, parent, sources, material } = rescueFixture();
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .2), material);
  parent.add(door);
  const collider = sources[0];
  const otherParent = new THREE.Group(); scene.add(otherParent);
  otherParent.add(sources[1]);
  const transparent = sources[2];
  transparent.material = new THREE.MeshStandardMaterial({ transparent: true });
  const rescue = createStaticSceneBatchRescue(scene, { protectedMeshes: [collider] });
  const ray = new THREE.Raycaster(new THREE.Vector3(4, 10, 4), new THREE.Vector3(0, -1, 0));
  scene.updateMatrixWorld(true);
  const before = ray.intersectObject(collider)[0];
  finishRescue(rescue);
  assert.equal(rescue.snapshot.savedSubmissions, 0);
  assert.equal(collider.parent, parent);
  assert.equal(door.parent, parent);
  assert.equal(transparent.parent, parent);
  assert.equal(sources[1].parent, otherParent);
  const after = ray.intersectObject(collider)[0];
  assert.equal(after.distance, before.distance);
  assert.deepEqual(after.face.normal, before.face.normal);
});

test('copy and per-update chunk limits bound extra buffers and generation work', () => {
  const { scene } = rescueFixture();
  const rescue = createStaticSceneBatchRescue(scene, { now: () => 0 });
  let previousBytes = 0;
  for (let i = 0; i < 1000 && !rescue.snapshot.ready; i++) {
    rescue.update({ enabled: true, maxChunks: 1 });
    assert.ok(rescue.snapshot.copiedBytes - previousBytes <= 4096 * 4);
    previousBytes = rescue.snapshot.copiedBytes;
  }
  assert.equal(rescue.snapshot.ready, true);
  assert.ok(rescue.snapshot.updates > 10);
  rescue.dispose();
  const capped = createStaticSceneBatchRescue(scene, { maxBytes: 1 });
  finishRescue(capped);
  assert.equal(capped.snapshot.savedSubmissions, 0);
  assert.equal(capped.snapshot.copiedBytes, 0);
  const small = createStaticSceneBatchRescue(scene, { maxBatchVertices: 72 });
  finishRescue(small);
  assert.equal(small.snapshot.activeBatches, 2);
  assert.equal(small.snapshot.savedSubmissions, 2);
  small.dispose();
});

test('cancellation disposes partially allocated buffers without removing original geometry', () => {
  const { scene, parent, sources } = rescueFixture();
  const rescue = createStaticSceneBatchRescue(scene, { now: () => 0 });
  for (let frame = 0; frame < 1000 && rescue.snapshot.copiedBytes === 0; frame++)
    rescue.update({ enabled: true, maxChunks: 1 });
  assert.ok(rescue.snapshot.copiedBytes > 0);
  assert.equal(rescue.snapshot.ready, false);
  rescue.dispose();
  assert.deepEqual(new Set(parent.children), new Set(sources));
  rescue.update({ enabled: true });
  assert.equal(rescue.snapshot.activeBatches, 0);
});
