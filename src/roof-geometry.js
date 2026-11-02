import * as THREE from 'three';

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
