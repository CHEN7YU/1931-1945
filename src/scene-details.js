import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const pilotFronts = new Set(['west-0', 'east-0', 'courtyard-shop']);

export function streetGrimePatches(town) {
  const patches = [];
  for (const building of town.buildings.filter(item => pilotFronts.has(item.id))) {
    const front = building.x + building.facing * building.w / 2;
    const walls = town.pieces.filter(piece => piece.wall && piece.material === 'plaster' &&
      piece.id.startsWith(`${building.id}-`) && Math.abs(piece.x - front) < .01);
    const stains = [
      { z: building.z - 5, y: .45, w: 3.2, h: .86, cell: 0 },
      { z: building.z - .4, y: .3, w: 3.4, h: .56, cell: 3 },
      { z: building.z + 4.7, y: .3, w: 2.8, h: .56, cell: 2 },
      { z: building.z - 3.4, y: .47, w: 1.65, h: .9, cell: 1 },
    ];
    for (const [index, stain] of stains.entries()) for (const wall of walls) {
      const minZ = Math.max(stain.z - stain.w / 2, wall.z - wall.d / 2);
      const maxZ = Math.min(stain.z + stain.w / 2, wall.z + wall.d / 2);
      const minY = Math.max(stain.y - stain.h / 2, wall.y - wall.h / 2);
      const maxY = Math.min(stain.y + stain.h / 2, wall.y + wall.h / 2);
      if (maxZ - minZ < .025 || maxY - minY < .025) continue;
      patches.push({
        id: `${building.id}-grime-${index}-${wall.id}`, buildingId: building.id, wallId: wall.id,
        x: wall.x + building.facing * (wall.w / 2 + .006), normal: building.facing,
        z: (minZ + maxZ) / 2, y: (minY + maxY) / 2, w: maxZ - minZ, h: maxY - minY,
        stain: { ...stain },
      });
    }
  }
  return patches;
}

export function grimePatchGeometry(patch) {
  const geometry = new THREE.PlaneGeometry(patch.w, patch.h);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv;
  const column = patch.stain.cell % 2, row = Math.floor(patch.stain.cell / 2);
  const inset = 2 / 1024, span = .5 - 2 * inset;
  for (let i = 0; i < positions.count; i++) {
    const z = patch.z - patch.normal * positions.getX(i);
    const y = patch.y + positions.getY(i);
    const u = (z - patch.stain.z) / patch.stain.w + .5;
    const v = (y - patch.stain.y) / patch.stain.h + .5;
    uv.setXY(i, column * .5 + inset + u * span, (1 - row) * .5 + inset + v * span);
  }
  return geometry;
}

export function sandbagGeometry() {
  const body = new THREE.SphereGeometry(1, 24, 12);
  const positions = body.attributes.position, uv = body.attributes.uv;
  const signedPower = (value, exponent) => Math.sign(value) * Math.pow(Math.abs(value), exponent);
  const point = (theta, phi) => {
    const x = signedPower(Math.cos(theta), .62);
    const r = Math.pow(Math.max(0, Math.sin(theta)), .55) *
      (1 - .12 * Math.pow(Math.abs(x), 8)) *
      (1 + .055 * Math.sin(phi * 8 + theta * 3) * Math.pow(Math.abs(x), 5));
    const result = new THREE.Vector3(x, Math.max(-.82, signedPower(Math.cos(phi), .7) * r * .92),
      signedPower(Math.sin(phi), .7) * r * .98);
    if (result.length() > .975) result.setLength(.975);
    return result;
  };
  for (let i = 0; i < positions.count; i++) {
    const theta = (1 - uv.getY(i)) * Math.PI, phi = uv.getX(i) * Math.PI * 2;
    const p = point(theta, phi);
    positions.setXYZ(i, p.x, p.y, p.z);
    uv.setXY(i, (p.x + 1) * .59 / .35, phi * .33 / .35);
  }
  body.computeVertexNormals();
  const color = (geometry, value) => {
    const colors = new Float32Array(geometry.attributes.position.count * 3).fill(value);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry.index ? geometry.toNonIndexed() : geometry;
  };
  const geometries = [color(body, 1)];
  for (const side of [-1, 1]) {
    const points = Array.from({ length: 17 }, (_, i) => {
      const p = point(.12 + i / 16 * (Math.PI - .24), side * Math.PI / 2);
      p.z += side * .014;
      return p;
    });
    const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, .009, 4, false);
    geometries.push(color(seam, .64));
    seam.dispose();
  }
  const result = mergeGeometries(geometries);
  geometries.forEach(geometry => geometry.dispose());
  body.dispose();
  const merged = result.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < merged.count; i++) {
    p.fromBufferAttribute(merged, i);
    if (p.length() > .999) {
      p.setLength(.999);
      merged.setXYZ(i, p.x, p.y, p.z);
    }
  }
  result.scale(1, 1, .95);
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

export function sandbagCollisionProxy(visual, geometry) {
  const collision = new THREE.Mesh(geometry, visual.material);
  collision.position.copy(visual.position);
  collision.rotation.copy(visual.rotation);
  collision.scale.copy(visual.scale);
  collision.visible = false;
  return collision;
}
