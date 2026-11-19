import { BufferAttribute, BufferGeometry } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const DISTANT_WEAPON_TRIANGLE_BUDGET = 3000;
let simplifierReady = false;

export async function prepareDistantGeometry() {
  if (!MeshoptSimplifier.supported) throw new Error('Distant character geometry requires WebAssembly simplification support');
  await MeshoptSimplifier.ready;
  simplifierReady = true;
}

export async function createDistantPoseGeometry(source, { animated = false } = {}) {
  await prepareDistantGeometry();
  return simplifyGeometry(source, .08, .005, 'distantPoseLod', animated);
}

export function createLowMemoryPoseGeometry(source) {
  if (!simplifierReady) throw new Error('Low-memory poses require the prepared geometry simplifier');
  const indexed = source.index ? source : indexedAnimatedSource(source);
  try { return simplifyGeometry(indexed, .08, .01, 'lowMemoryPose', true); }
  finally { if (indexed !== source) indexed.dispose(); }
}

export function indexedAnimatedSource(source) {
  const working = new BufferGeometry(), morphNames = [];
  for (const [name, attribute] of Object.entries(source.attributes))
    if (!attribute.isInstancedBufferAttribute && (name !== 'normal' || !source.attributes.nraPoseVertex))
      working.setAttribute(name, attribute);
  if (source.attributes.nraPoseVertex) {
    working.morphAttributes.position = source.morphAttributes.position ?? [];
  } else for (const [name, attributes] of Object.entries(source.morphAttributes)) {
    attributes.forEach((attribute, frame) => {
      const key = `resourcePose_${name}_${frame}`;
      working.setAttribute(key, attribute); morphNames.push({ key, name });
    });
  }
  const indexed = indexPoseVertices(working); working.dispose();
  if (source.attributes.nraPoseVertex) {
    indexed.computeVertexNormals();
    indexed.morphAttributes.normal = indexed.morphAttributes.position.map(position => {
      const frame = new BufferGeometry(); frame.setIndex(indexed.index); frame.setAttribute('position', position);
      frame.computeVertexNormals(); const normal = frame.attributes.normal; frame.dispose(); return normal;
    });
  } else for (const { key, name } of morphNames) {
    (indexed.morphAttributes[name] ??= []).push(indexed.attributes[key]); indexed.deleteAttribute(key);
  }
  for (const [name, attribute] of Object.entries(source.attributes))
    if (attribute.isInstancedBufferAttribute) indexed.setAttribute(name, attribute.clone());
  indexed.morphTargetsRelative = source.morphTargetsRelative;
  indexed.boundingBox = source.boundingBox?.clone() ?? null;
  indexed.boundingSphere = source.boundingSphere?.clone() ?? null;
  return indexed;
}

function indexPoseVertices(source) {
  const attributes = Object.entries(source.attributes);
  const isPlain = a => a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute;
  if ([...attributes.map(([, a]) => a), ...Object.values(source.morphAttributes).flat()].some(a => !isPlain(a)))
    return mergeVertices(source, 1e-6);
  const count = source.attributes.position.count;
  const stride = attributes.reduce((sum, [, a]) => sum + a.itemSize, 0);
  const keys = new Int32Array(count * stride);
  let column = 0;
  for (const [, { array, itemSize }] of attributes) {
    for (let vertex = 0; vertex < count; vertex++) for (let i = 0; i < itemSize; i++)
      // Same signed truncation and tolerance as Three's mergeVertices.
      keys[vertex * stride + column + i] = (array[vertex * itemSize + i] * 1e6 + .5) | 0;
    column += itemSize;
  }
  const indices = new Uint32Array(count);
  const representatives = [], next = new Uint32Array(count), buckets = new Map();
  for (let vertex = 0; vertex < count; vertex++) {
    const offset = vertex * stride;
    let hash = 2166136261;
    for (let j = 0; j < stride; j++) hash = Math.imul(hash ^ keys[offset + j], 16777619);
    const head = buckets.get(hash) ?? 0;
    let match = head;
    while (match) {
      const other = representatives[match - 1] * stride;
      let j = 0;
      while (j < stride && keys[offset + j] === keys[other + j]) j++;
      if (j === stride) break;
      match = next[match - 1];
    }
    if (!match) {
      next[representatives.length] = head;
      match = representatives.push(vertex);
      buckets.set(hash, match);
    }
    indices[vertex] = match - 1;
  }
  const compact = attribute => {
    const { array, itemSize } = attribute;
    const output = new array.constructor(representatives.length * itemSize);
    for (let vertex = 0; vertex < representatives.length; vertex++)
      for (let i = 0; i < itemSize; i++) output[vertex * itemSize + i] = array[representatives[vertex] * itemSize + i];
    return new BufferAttribute(output, itemSize, attribute.normalized);
  };
  const result = new BufferGeometry();
  for (const [name, attribute] of attributes) result.setAttribute(name, compact(attribute));
  for (const [name, frames] of Object.entries(source.morphAttributes)) result.morphAttributes[name] = frames.map(compact);
  result.setIndex(new BufferAttribute(representatives.length <= 65535 ? new Uint16Array(indices) : indices, 1));
  return result;
}

export function createDistantWeaponGeometry(source) {
  // Body preparation has already awaited the shared simplifier before this synchronous render path.
  const indexed = source.index ? source : mergeVertices(source, 1e-6);
  try { return simplifyGeometry(indexed, .06, .008, 'distantWeaponLod'); }
  finally { if (indexed !== source) indexed.dispose(); }
}

function simplifyGeometry(source, ratio, errorLimit, statisticsKey, animated = false) {
  const position = source.attributes.position;
  if (!position || position.itemSize !== 3 || !(position.array instanceof Float32Array) || source.groups.length) {
    throw new Error('Distant LOD requires a merged Float32 triangle pose');
  }
  const indices = source.index ? new Uint32Array(source.index.array)
    : Uint32Array.from({ length: position.count }, (_, index) => index);
  if (!indices.length || indices.length % 3) throw new Error('Distant LOD requires complete triangles');
  const fields = ['normal', 'uv', 'nraUniformUv', 'nraSkinRegion'].filter(name => source.attributes[name])
    .map(name => ({ attribute: source.attributes[name], weight: name === 'normal' ? .2 : 1 }));
  if (animated && source.morphAttributes.position?.length) {
    const frames = source.morphAttributes.position, selected = new Set([0, Math.floor(frames.length / 2), frames.length - 1]);
    for (const frame of selected) fields.push({ attribute: frames[frame], weight: 1 });
  }
  const weights = fields.flatMap(({ attribute, weight }) => Array(attribute.itemSize).fill(weight));
  const attributes = new Float32Array(position.count * weights.length);
  for (let vertex = 0; vertex < position.count; vertex++) {
    let offset = vertex * weights.length;
    for (const { attribute } of fields) {
      for (let component = 0; component < attribute.itemSize; component++) {
        attributes[offset++] = attribute.array[vertex * attribute.itemSize + component];
      }
    }
  }
  const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, position.array, 3,
    attributes, weights.length, weights, null, Math.max(3, Math.floor(indices.length * ratio / 3) * 3), errorLimit);
  const [remap, count] = MeshoptSimplifier.compactMesh(reduced);
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (attribute.isInstancedBufferAttribute) {
      geometry.setAttribute(name, attribute.clone());
      continue;
    }
    const array = new attribute.array.constructor(count * attribute.itemSize);
    for (let vertex = 0; vertex < remap.length; vertex++) if (remap[vertex] !== 0xffffffff) {
      array.set(attribute.array.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize),
        remap[vertex] * attribute.itemSize);
    }
    geometry.setAttribute(name, new BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  for (const [name, attributes] of Object.entries(source.morphAttributes)) {
    geometry.morphAttributes[name] = attributes.map(attribute => {
      if (attribute.count !== position.count) throw new Error('Resource LOD morph topology differs from its base pose');
      const array = new attribute.array.constructor(count * attribute.itemSize);
      for (let vertex = 0; vertex < remap.length; vertex++) if (remap[vertex] !== 0xffffffff) {
        array.set(attribute.array.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize),
          remap[vertex] * attribute.itemSize);
      }
      return new BufferAttribute(array, attribute.itemSize, attribute.normalized);
    });
  }
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.setIndex(new BufferAttribute(count <= 65535 ? new Uint16Array(reduced) : reduced, 1));
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData[statisticsKey] = { sourceTriangles: indices.length / 3, triangles: reduced.length / 3,
    sourceVertices: position.count, vertices: count, error };
  return geometry;
}

export function useDistantPose(camera, distance, wasDistant, preset) {
  const equivalentDistance = distance * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / Math.tan(72 * Math.PI / 360);
  return equivalentDistance > (preset === 'low' ? 18 : 28) + (wasDistant ? -3 : 3);
}
