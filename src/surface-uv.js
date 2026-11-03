import * as THREE from 'three';

export function bakeSurfaceGeometry(object, { preserveUV = false } = {}) {
  const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
  const meters = object.material.userData.metersPerTile;
  if (preserveUV || meters === undefined || object.userData.keepUV) return geometry;
  if (!Number.isFinite(meters) || meters <= 0) throw new RangeError('metersPerTile must be positive and finite');
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
  if (!uv || !normals) throw new Error('Surface UV projection requires positions, normals and UVs');
  const timber = object.material.userData.surface === 'timber';
  const scale = new THREE.Vector3().setFromMatrixScale(object.matrixWorld);
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  object.geometry.computeBoundingBox();
  const size = object.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(scale);
  const grain = size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z';
  const cylinder = object.geometry.type === 'CylinderGeometry';
  for (let i = 0; i < positions.count; i++) {
    if (timber) {
      point.fromBufferAttribute(object.geometry.attributes.position, i).multiply(scale);
      normal.fromBufferAttribute(object.geometry.attributes.normal, i).divide(scale);
    } else {
      point.fromBufferAttribute(positions, i);
      normal.fromBufferAttribute(normals, i);
    }
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    if (timber && cylinder && ay < Math.max(ax, az)) {
      // Unwrap the circumference once; planar projection folds grain at each facet.
      const radius = Math.hypot(point.x, point.z);
      uv.setXY(i, object.geometry.attributes.uv.getX(i) * 2 * Math.PI * radius / meters, point.y / meters);
    } else if (timber && Math.abs(normal[grain]) < Math.max(ax, ay, az)) {
      const across = grain === 'y' ? (ax >= az ? 'z' : 'x')
        : grain === 'x' ? (ay >= az ? 'z' : 'y') : (ay >= ax ? 'x' : 'y');
      // The bundled timber scan runs along V, including rotated beams and floorboards.
      uv.setXY(i, point[across] / meters, point[grain] / meters);
    } else if (ay >= ax && ay >= az) uv.setXY(i, point.x / meters, point.z / meters);
    else if (ax >= az) uv.setXY(i, point.z / meters, point.y / meters);
    else uv.setXY(i, point.x / meters, point.y / meters);
  }
  return geometry;
}
// ---模块结束---
