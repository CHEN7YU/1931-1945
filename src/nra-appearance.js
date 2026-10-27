import * as THREE from 'three';

const complexions = ['#fff8f1', '#f3e5d7', '#e2c8ae', '#d7b797', '#eddbcb'];
export const NRA_FACE_NAME = '\u81c9\u90e8';
export const NRA_HAND_NAME = '\u624b\u90e8';
const faces = [
  { jaw: -.8, cheek: -.4, nose: -.4, chin: -.3, brow: -.2 },
  { jaw: .8, cheek: .3, nose: .2, chin: .4, brow: .2 },
  { jaw: -.3, cheek: .8, nose: -.6, chin: -.5, brow: .1 },
  { jaw: .4, cheek: -.5, nose: .8, chin: .6, brow: -.3 },
  { jaw: -.6, cheek: .2, nose: .6, chin: .2, brow: .3 },
  { jaw: .2, cheek: .6, nose: -.2, chin: -.7, brow: -.2 },
  { jaw: .7, cheek: -.3, nose: -.5, chin: .1, brow: .4 },
  { jaw: -.4, cheek: -.7, nose: .3, chin: .7, brow: -.4 },
];

export function createNraAppearance(actor) {
  if (!actor?.id || !actor.unitId) throw new Error('Soldier appearance requires an owned identity');
  let seed = 2166136261;
  for (const letter of `${actor.unitId}:${actor.id}`) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  const face = (seed >>> 8) % faces.length, complexion = seed % complexions.length, build = (seed >>> 16) % 3 - 1;
  return Object.freeze({ key: `${face}-${complexion}-${build}`, face, complexion, skin: complexions[complexion], build });
}

export function isNraSkin(name) { return name === NRA_FACE_NAME || name === NRA_HAND_NAME; }

const bell = (value, center, width) => Math.exp(-(((value - center) / width) ** 2));
const clamp = value => Math.max(0, Math.min(1, value));

export function sculptNraPoint(point, faceIndex, build, face) {
  const result = point.clone(), x = point.x, y = point.y, z = point.z;
  if (face) {
    const shape = faces[faceIndex];
    if (!shape) throw new Error('Unknown NRA face family');
    const front = clamp((z - 1) / 7), eyeGuard = 1 - bell(y, 173, 2.2) * bell(Math.abs(x), 3.7, 2);
    result.x += x * front * eyeGuard * (shape.jaw * .13 * bell(y, 162, 5) + shape.cheek * .08 * bell(y, 169, 4));
    const nose = bell(x, 0, 1.8) * bell(y, 169.2, 2.6) * clamp((z - 7) / 3);
    result.z += shape.nose * .85 * nose;
    result.x += x * shape.nose * .18 * nose;
    result.y += shape.chin * .65 * bell(y, 160, 3.5) * front;
    result.z += shape.brow * .4 * bell(y, 176, 1.3) * front * eyeGuard;
  } else {
    const torso = bell(y, 121, 24) * clamp((34 - Math.abs(x)) / 12);
    result.x *= 1 + build * .055 * torso;
    result.z *= 1 + build * .04 * torso;
  }
  return result;
}

function smoothNormals(geometry) {
  const positions = geometry.attributes.position, sums = new Map(), keys = [];
  for (let index = 0; index < positions.count; index++) {
    const key = [positions.getX(index), positions.getY(index), positions.getZ(index)].map(value => Math.round(value * 1e6)).join(':');
    keys.push(key);
    if (!sums.has(key)) sums.set(key, new THREE.Vector3());
  }
  const indices = geometry.index, count = indices?.count ?? positions.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let index = 0; index < count; index += 3) {
    const ids = [0, 1, 2].map(offset => indices ? indices.getX(index + offset) : index + offset);
    a.fromBufferAttribute(positions, ids[0]); b.fromBufferAttribute(positions, ids[1]); c.fromBufferAttribute(positions, ids[2]);
    normal.subVectors(c, b).cross(a.sub(b));
    for (const id of ids) sums.get(keys[id]).add(normal);
  }
  const normals = geometry.attributes.normal;
  for (let index = 0; index < positions.count; index++) {
    normal.copy(sums.get(keys[index])).normalize(); normals.setXYZ(index, normal.x, normal.y, normal.z);
  }
}

export function createNraAppearanceApplicator(meshes, cache = { geometries: new Map(), materials: new Map() }) {
  const originals = new Map(meshes.map(mesh => [mesh, { geometry: mesh.geometry, material: mesh.material }]));
  const geometryCache = cache.geometries, materialCache = cache.materials;
  const point = new THREE.Vector3();
  let current = null;
  return {
    apply(appearance) {
      if (current === (appearance?.key ?? null)) return;
      current = appearance?.key ?? null;
      for (const mesh of meshes) {
        const original = originals.get(mesh), face = mesh.name === NRA_FACE_NAME;
        if (appearance && (face || !isNraSkin(mesh.name))) {
          const key = `${mesh.name}:${face ? appearance.face : appearance.build}`;
          if (!geometryCache.has(key)) {
            const geometry = original.geometry.clone(), positions = geometry.attributes.position;
            const inverse = mesh.bindMatrix.clone().invert();
            for (let index = 0; index < positions.count; index++) {
              point.fromBufferAttribute(original.geometry.attributes.position, index).applyMatrix4(mesh.bindMatrix);
              point.copy(sculptNraPoint(point, appearance.face, appearance.build, face)).applyMatrix4(inverse);
              positions.setXYZ(index, point.x, point.y, point.z);
            }
            if (face) smoothNormals(geometry);
            geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometryCache.set(key, geometry);
          }
          mesh.geometry = geometryCache.get(key);
        } else mesh.geometry = original.geometry;
        if (appearance && isNraSkin(mesh.name)) {
          const key = `${mesh.name}:${appearance.complexion}`;
          if (!materialCache.has(key)) {
            const tinted = (Array.isArray(original.material) ? original.material : [original.material]).map(material => {
              const copy = material.clone(); copy.color.set(appearance.skin); return copy;
            });
            materialCache.set(key, Array.isArray(original.material) ? tinted : tinted[0]);
          }
          mesh.material = materialCache.get(key);
        } else mesh.material = original.material;
      }
    },
    get key() { return current; },
  };
}
