import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function createResidentialRoofGeometry(width, depth, rise, meters, damaged, serial) {
  if (!damaged) return createRoofGeometry(width, depth, rise, meters);
  const fragments = [];
  for (let strip = 0; strip < 12; strip++) {
    const fragment = createRoofGeometry(width, depth / 12, rise, meters);
    fragment.translate(0, 0, -depth / 2 + (strip + .5) * depth / 12);
    const positions = fragment.attributes.position, indices = [];
    for (let vertex = 0; vertex < positions.count; vertex++)
      fragment.attributes.uv.setY(vertex, positions.getZ(vertex) / meters);
    for (let vertex = 0; vertex < positions.count; vertex += 3) {
      const center = (positions.getX(vertex) + positions.getX(vertex + 1) + positions.getX(vertex + 2)) / 3;
      if (center <= -(width - .6) * (.03 + .045 * (1 + Math.sin(strip * 2.7 + serial))))
        indices.push(vertex, vertex + 1, vertex + 2);
    }
    fragment.setIndex(indices); fragments.push(fragment.toNonIndexed()); fragment.dispose();
  }
  const geometry = mergeGeometries(fragments);
  for (const fragment of fragments) fragment.dispose();
  return geometry;
}

export function createRoofGeometry(w, d, rise, meters) {
  const vertices = [], uv = [], distances = [0], segments = 16;
  const height = u => rise * Math.pow(1 - Math.abs(u), .84) + Math.pow(Math.abs(u), 7) * .27;
  for (let i = 0; i < segments; i++) {
    const a = i / segments * 2 - 1, b = (i + 1) / segments * 2 - 1;
    distances.push(distances[i] + Math.hypot((b - a) * w / 2, height(b) - height(a)));
  }
  for (let i = 0; i < segments; i++) {
    const a = i / segments * 2 - 1, b = (i + 1) / segments * 2 - 1;
    for (const [u, v] of [[a, -1], [a, 1], [b, -1], [b, -1], [a, 1], [b, 1]]) {
      vertices.push(u * w / 2, height(u), v * d / 2);
      uv.push(distances[u === a ? i : i + 1] / meters, v * d / 2 / meters);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}
