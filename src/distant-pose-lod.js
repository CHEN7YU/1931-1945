import { BufferAttribute, BufferGeometry } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export async function createDistantPoseGeometry(source) {
  if (!MeshoptSimplifier.supported) throw new Error('Distant character geometry requires WebAssembly simplification support');
  await MeshoptSimplifier.ready;
  const position = source.attributes.position;
  if (!position || position.itemSize !== 3 || !(position.array instanceof Float32Array) || source.groups.length) {
    throw new Error('Distant LOD requires a merged Float32 triangle pose');
  }
  const indices = source.index ? new Uint32Array(source.index.array)
    : Uint32Array.from({ length: position.count }, (_, index) => index);
  if (!indices.length || indices.length % 3) throw new Error('Distant LOD requires complete triangles');
  const names = ['normal', 'uv', 'nraUniformUv', 'nraSkinRegion'].filter(name => source.attributes[name]);
  const weights = names.flatMap(name => Array(source.attributes[name].itemSize).fill(name === 'normal' ? .2 : 1));
  const attributes = new Float32Array(position.count * weights.length);
  for (let vertex = 0; vertex < position.count; vertex++) {
    let offset = vertex * weights.length;
    for (const name of names) {
      const attribute = source.attributes[name];
      for (let component = 0; component < attribute.itemSize; component++) {
        attributes[offset++] = attribute.array[vertex * attribute.itemSize + component];
      }
    }
  }
  const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, position.array, 3,
    attributes, weights.length, weights, null, Math.max(3, Math.floor(indices.length * .12 / 3) * 3), .003);
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
  geometry.setIndex(new BufferAttribute(count <= 65535 ? new Uint16Array(reduced) : reduced, 1));
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData.distantPoseLod = { sourceTriangles: indices.length / 3, triangles: reduced.length / 3,
    sourceVertices: position.count, vertices: count, error };
  return geometry;
}

export function useDistantPose(camera, distance, wasDistant, preset) {
  const equivalentDistance = distance * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / Math.tan(72 * Math.PI / 360);
  return equivalentDistance > (preset === 'low' ? 18 : 28) + (wasDistant ? -3 : 3);
}
