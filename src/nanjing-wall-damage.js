import * as THREE from 'three';

const walls = {
  south: {
    notches: [{ x: -42.7, radius: 3.2, depth: 2.45 }, { x: 72.8, radius: 2.7, depth: 1.95 }],
    clusters: [-63, -49, -42, -35, -26, 29, 38, 67, 74, 83, 98],
    front: 20.4, heading: 0, step: .19,
  },
  west: {
    notches: [{ x: 32, radius: 3.3, depth: 2.25 }],
    clusters: [-6, 8, 24, 32, 38, 47, 60],
    front: -69.8, heading: Math.PI / 2, step: .24,
  },
  north: {
    notches: [{ x: -31, radius: 4.2, depth: 2.65 }],
    clusters: [-61, -49, -32, -26, -8, 15, 41, 58, 76, 96],
    front: -110.8, heading: 0, step: .30,
  },
};

export const NANJING_WALL_PLUMES = Object.freeze(Object.entries(walls).flatMap(([wall, { notches, front, heading }]) =>
  notches.map(({ x }) => Object.freeze({ wall, heading,
    x: wall === 'west' ? front : x, z: wall === 'west' ? -x : front }))));

export function nanjingWallNotch(wall, x) {
  let depth = 0;
  for (const notch of walls[wall].notches) {
    const edge = Math.abs(x - notch.x) / notch.radius;
    const teeth = .13 * Math.sin(x * 5.3) + .09 * Math.cos(x * 13.1);
    depth = Math.max(depth, notch.depth * Math.max(0, 1 - edge ** 1.25) * (1 + teeth));
  }
  return depth;
}

function wallPits(wall, minX, maxX) {
  const pits = [];
  for (const [cluster, x] of walls[wall].clusters.entries()) {
    for (let i = 0; i < 9; i++) {
      const seed = i + cluster * 11;
      const offset = i === 0 ? 0 : Math.sin(seed * 8.19) * (1.3 + i * .58);
      const y = i === 0 ? 3.15 + Math.sin(cluster * 7.3) * .85 : 1 + (seed * 1.91) % 6.1;
      const radius = i === 0 ? 1.08 + cluster % 3 * .19 : i % 3 === 0 ? .57 : .27 + i % 4 * .071;
      if (x + offset - radius * 1.25 < minX || x + offset + radius * 1.25 > maxX) continue;
      if (wall === 'south' && (x + offset < -25.5 && x + offset > -34.5 || x + offset > 44 && x + offset < 66) &&
          Math.abs(y - 4.7) < 2.7 + radius) continue;
      pits.push({ x: x + offset, y, radius, seed });
    }
  }
  return pits;
}

export function nanjingDamagedWallGeometry(wall, minX, maxX, height, thickness, meters) {
  const width = maxX - minX;
  const step = walls[wall].step;
  const geometry = new THREE.BoxGeometry(1, 1, 1, Math.ceil(width / step), Math.ceil(height / step), 9);
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
  const colors = new Float32Array(positions.count * 3);
  const pits = wallPits(wall, minX, maxX);
  for (let i = 0; i < positions.count; i++) {
    const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
    const x = minX + (px + .5) * width, y = (py + .5) * height;
    const front = 1 - THREE.MathUtils.smoothstep((.5 - pz) * thickness, 0, 1.65);
    const notch = nanjingWallNotch(wall, x) * front * THREE.MathUtils.smoothstep(y, height - 3.4, height);
    let recess = 0, shade = 0;
    if (pz === .5) for (const pit of pits) {
      const dx = (x - pit.x) / pit.radius, dy = (y - pit.y) / (pit.radius * .8);
      if (Math.abs(dx) > 1.26 || Math.abs(dy) > 1.26) continue;
      const angle = Math.atan2(dy, dx);
      const edge = Math.hypot(dx, dy) / (1 + .13 * Math.sin(5 * angle + pit.seed) +
        .09 * Math.cos(9 * angle - pit.seed));
      recess = Math.max(recess, pit.radius * .57 * Math.max(0, 1 - edge ** 1.45));
      shade = Math.max(shade, .78 * (1 - THREE.MathUtils.smoothstep(edge, .37, 1.25)));
    }
    positions.setXYZ(i, px, py - notch / height, pz - recess / thickness);
    const side = Math.abs(normals.getX(i)) > .5, top = Math.abs(normals.getY(i)) > .5;
    uv.setXY(i, (side ? pz * thickness - recess : px * width) / meters,
      (top ? pz * thickness : py * height - notch) / meters);
    const exposed = THREE.MathUtils.smoothstep(notch, .2, 1.2);
    const tint = 1 - shade - exposed * .12 * (1 - shade);
    colors.set([tint, tint * (1 - exposed * .12), tint * (1 - exposed * .29)], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
