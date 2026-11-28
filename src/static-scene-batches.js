import { Box3, BufferAttribute, BufferGeometry, Matrix4, Mesh, Sphere, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeSurfaceGeometry } from './surface-uv.js';

export const STATIC_BATCH_CELL_SIZE = 32;

export function staticGeometryBatches(objects, { spatial = false, preserveUV = false } = {}) {
  const batches = new Map(), center = new Vector3();
  for (const object of objects) {
    const baked = bakeSurfaceGeometry(object, { preserveUV });
    baked.computeBoundingBox();
    baked.boundingBox.getCenter(center);
    // Only opt-in geometry can change submission order; preserve coplanar and transparent batches.
    const cell = object.material.transparent ? 'transparent'
      : spatial || object.material.userData.spatialBatch
        ? `${Math.floor(center.x / STATIC_BATCH_CELL_SIZE)},${Math.floor(center.z / STATIC_BATCH_CELL_SIZE)}` : 'global';
    if (!batches.has(object.material)) batches.set(object.material, new Map());
    const material = batches.get(object.material);
    if (!material.has(cell)) material.set(cell, []);
    material.get(cell).push(baked.index ? baked.toNonIndexed() : baked);
    if (baked.index) baked.dispose();
    object.removeFromParent();
  }
  return batches;
}

export function batchStaticScene(scene, objects, { spatial = true } = {}) {
  const groups = new Map(), meshes = [];
  let triangles = 0;
  for (const object of objects) {
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh || !object.visible ||
      Array.isArray(object.material) || object.material.transparent) throw new Error('Static scene batching requires visible opaque non-animated meshes');
    const attributes = Object.entries(object.geometry.attributes).map(([name, attribute]) =>
      `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).sort().join(',');
    const key = `${object.castShadow}:${object.receiveShadow}:${object.renderOrder}:${attributes}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  }
  scene.updateMatrixWorld(true);
  for (const group of groups.values()) {
    const source = group[0];
    for (const [material, cells] of staticGeometryBatches(group, { spatial, preserveUV: true })) {
      for (const [cell, geometries] of cells) {
        const geometry = mergeGeometries(geometries);
        if (!geometry) throw new Error('Compatible static scene geometry failed to merge');
        const mesh = new Mesh(geometry, material);
        mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
        mesh.renderOrder = source.renderOrder;
        mesh.userData.staticSceneBatch = true; mesh.userData.staticCell = cell;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        scene.add(mesh); meshes.push(mesh);
        for (const baked of geometries) baked.dispose();
      }
    }
  }
  return { sources: objects.length, batches: meshes.length, triangles, cellSize: STATIC_BATCH_CELL_SIZE };
}

// Opt-in rescue for existing baked batches only; no material substitutions or geometry simplification.
// Call update once per rAF, outside simulation steps. Pass authoritative solids as protectedMeshes.
export function createStaticSceneBatchRescue(scene, {
  protectedMeshes = [], cellSize = 128, maxBatchVertices = 32768, maxBytes = 24 * 1024 * 1024,
  now = () => performance.now(),
} = {}) {
  if (!Number.isFinite(cellSize) || cellSize < STATIC_BATCH_CELL_SIZE ||
    !Number.isInteger(maxBatchVertices) || maxBatchVertices < 3 || maxBatchVertices > 65536 ||
    !Number.isFinite(maxBytes) || maxBytes < 0 || typeof now !== 'function') throw new RangeError('Invalid static rescue limits');
  const protectedSet = new Set(protectedMeshes), identity = new Matrix4(), records = [];
  let enabled = false, disposed = false, ready = false, copiedBytes = 0, reservedBytes = 0, pendingGeometry = null;
  let sourceBatches = 0, updates = 0, buildWorkMs = 0;
  const compatible = object => {
    const geometry = object.geometry;
    if (!object.userData.staticSceneBatch || protectedSet.has(object) || !object.isMesh ||
      object.isInstancedMesh || object.isSkinnedMesh || !object.visible || !object.parent ||
      Array.isArray(object.material) || object.material.transparent || geometry.index ||
      Object.keys(geometry.morphAttributes).length ||
      geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity ||
      !geometry.boundingBox || object.customDepthMaterial || object.customDistanceMaterial ||
      object.onBeforeRender !== Mesh.prototype.onBeforeRender ||
      object.onAfterRender !== Mesh.prototype.onAfterRender) return false;
    if (object.matrixAutoUpdate) object.updateMatrix();
    return object.matrix.equals(identity) && Object.values(geometry.attributes).every(attribute =>
      attribute.isBufferAttribute && !attribute.isInterleavedBufferAttribute && !attribute.isInstancedBufferAttribute &&
      !attribute.isFloat16BufferAttribute);
  };
  const valid = record => record.sources.every((object, index) =>
    object.parent === (record.active ? null : record.parent) && object.visible &&
    object.geometry === record.geometries[index] && object.material === record.mesh.material);
  const activate = record => {
    if (record.active || !valid(record)) return;
    for (const object of record.sources) object.removeFromParent();
    record.parent.add(record.mesh); record.active = true;
  };
  const restore = record => {
    if (!record.active) return;
    record.mesh.removeFromParent();
    for (const object of record.sources) record.parent.add(object);
    record.active = false;
  };
  function* build() {
    const groups = new Map(), stack = [scene], center = new Vector3();
    let scanned = 0;
    while (stack.length) {
      const object = stack.pop();
      for (const child of object.children) stack.push(child);
      if (compatible(object)) {
        sourceBatches++;
        const geometry = object.geometry, count = geometry.attributes.position.count;
        if (count <= maxBatchVertices) {
          geometry.boundingBox.getCenter(center);
          const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
          const signature = attributes.map(([name, attribute]) =>
            `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}:${attribute.gpuType}`).join(',');
          const key = [object.parent.id, object.material.id, object.castShadow, object.receiveShadow,
            object.renderOrder, object.layers.mask, object.frustumCulled, signature,
            Math.floor(center.x / cellSize), Math.floor(center.z / cellSize)].join('|');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(object);
        }
      }
      if (++scanned % 16 === 0) yield;
    }
    for (const group of groups.values()) {
      let sources = [], vertices = 0;
      const packs = [];
      for (const source of group) {
        const count = source.geometry.attributes.position.count;
        if (vertices + count > maxBatchVertices) { packs.push(sources); sources = []; vertices = 0; }
        sources.push(source); vertices += count;
        yield;
      }
      if (sources.length) packs.push(sources);
      for (const pack of packs) {
        if (pack.length < 2) continue;
        const first = pack[0], parent = first.parent, geometry = new BufferGeometry();
        pendingGeometry = geometry;
        const count = pack.reduce((sum, object) => sum + object.geometry.attributes.position.count, 0);
        const bytes = Object.values(first.geometry.attributes).reduce((sum, attribute) =>
          sum + count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT, 0);
        if (reservedBytes + bytes > maxBytes) { geometry.dispose(); pendingGeometry = null; continue; }
        reservedBytes += bytes;
        for (const [name, attribute] of Object.entries(first.geometry.attributes)) {
          const array = new attribute.array.constructor(count * attribute.itemSize);
          const merged = new BufferAttribute(array, attribute.itemSize, attribute.normalized);
          merged.gpuType = attribute.gpuType; merged.name = attribute.name;
          geometry.setAttribute(name, merged);
          yield;
          let offset = 0;
          for (const source of pack) {
            const input = source.geometry.attributes[name].array;
            for (let start = 0; start < input.length; start += 4096) {
              const end = Math.min(input.length, start + 4096);
              array.set(input.subarray(start, end), offset + start);
              copiedBytes += (end - start) * input.BYTES_PER_ELEMENT;
              yield;
            }
            offset += input.length;
          }
        }
        geometry.boundingBox = new Box3();
        for (const source of pack) geometry.boundingBox.union(source.geometry.boundingBox);
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
        const mesh = new Mesh(geometry, first.material);
        mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
        mesh.renderOrder = first.renderOrder; mesh.layers.mask = first.layers.mask;
        mesh.frustumCulled = first.frustumCulled;
        mesh.userData.staticSceneRescue = true;
        const record = { parent, sources: pack, geometries: pack.map(source => source.geometry), mesh, active: false };
        records.push(record);
        pendingGeometry = null;
        if (enabled) activate(record);
        yield;
      }
    }
    ready = true;
  }
  const builder = build();
  return {
    update({ enabled: requested = false, budgetMs = 1, maxChunks = 128 } = {}) {
      if (disposed) return;
      if (typeof requested !== 'boolean' || !Number.isFinite(budgetMs) || budgetMs <= 0 ||
        !Number.isInteger(maxChunks) || maxChunks < 1) throw new RangeError('Invalid static rescue work budget');
      if (requested !== enabled) {
        enabled = requested;
        for (const record of records) enabled ? activate(record) : restore(record);
      }
      if (!enabled || ready) return;
      const start = now(); updates++;
      for (let chunks = 0; chunks < maxChunks && now() - start < budgetMs; chunks++) {
        if (builder.next().done) break;
      }
      buildWorkMs += now() - start;
    },
    dispose() {
      for (const record of records) { restore(record); record.mesh.geometry.dispose(); }
      pendingGeometry?.dispose(); pendingGeometry = null;
      builder.return(); disposed = true; enabled = false;
    },
    get snapshot() {
      const active = records.filter(record => record.active);
      const activeSources = active.reduce((sum, record) => sum + record.sources.length, 0);
      return { enabled, ready, sourceBatches, coarseBatches: records.length, activeSources,
        activeBatches: active.length, savedSubmissions: activeSources - active.length,
        copiedBytes, reservedBytes, updates, buildWorkMs, cellSize, maxBatchVertices };
    },
  };
}
