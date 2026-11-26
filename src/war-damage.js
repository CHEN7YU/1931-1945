import * as THREE from 'three';
import { SHELL_CRATERS, CRATER_EDGE, STATIC_WRECKS, craterHeight } from './war-damage-layout.js';

export function damagedSurfaceGeometry(x, z, width, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(x - width / 2, -z - depth / 2);
  shape.lineTo(x + width / 2, -z - depth / 2);
  shape.lineTo(x + width / 2, -z + depth / 2);
  shape.lineTo(x - width / 2, -z + depth / 2); shape.closePath();
  for (const crater of SHELL_CRATERS) {
    const radius = crater.radius * CRATER_EDGE;
    const nearestX = Math.max(x - width / 2, Math.min(x + width / 2, crater.x));
    const nearestZ = Math.max(z - depth / 2, Math.min(z + depth / 2, crater.z));
    if (Math.hypot(nearestX - crater.x, nearestZ - crater.z) >= radius) continue;
    if (Math.abs(crater.x - x) + radius >= width / 2 || Math.abs(crater.z - z) + radius >= depth / 2) {
      throw new Error(`Crater ${crater.id} crosses a pavement boundary; split or relocate the surface before rendering`);
    }
    const hole = new THREE.Path();
    hole.absarc(crater.x, -crater.z, radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2);
}

export function craterGeometry(crater, base, craters = SHELL_CRATERS, sectors = 48, rings = 14, skirtDepth = 0) {
  const positions = [], uv = [], colors = [];
  const bed = new THREE.Color(0x65594b), edge = new THREE.Color(0xc3b29a);
  const add = (ring, sector) => {
    const r = ring / rings, angle = sector / sectors * Math.PI * 2;
    const x = crater.x + Math.cos(angle) * r * crater.radius * CRATER_EDGE;
    const z = crater.z + Math.sin(angle) * r * crater.radius * CRATER_EDGE;
    positions.push(x, base + craterHeight(x, z, craters), z); uv.push(x / 4, z / 4);
    const color = bed.clone().lerp(edge, r * r); colors.push(color.r, color.g, color.b);
  };
  for (let ring = 0; ring < rings; ring++) for (let sector = 0; sector < sectors; sector++) {
    for (const [r, a] of [[ring, sector], [ring + 1, sector + 1], [ring + 1, sector],
      [ring, sector], [ring, sector + 1], [ring + 1, sector + 1]]) add(r, a);
  }
  if (skirtDepth > 0) for (let sector = 0; sector < sectors; sector++) {
    for (const [index, y] of [[sector, base], [sector + 1, base], [sector, base - skirtDepth],
      [sector + 1, base], [sector + 1, base - skirtDepth], [sector, base - skirtDepth]]) {
      const angle = index / sectors * Math.PI * 2;
      const radius = crater.radius * CRATER_EDGE + (y < base ? skirtDepth : 0);
      const x = crater.x + Math.cos(angle) * radius;
      const z = crater.z + Math.sin(angle) * radius;
      positions.push(x, y, z); uv.push(x / 4, z / 4);
      colors.push(edge.r, edge.g, edge.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function addStaticWrecks(scene, { mesh, box, obstacles, groundHeight, timber, wrecks = STATIC_WRECKS }) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x484338, roughness: .97, metalness: .55 });
  const burned = new THREE.MeshStandardMaterial({ color: 0x242421, roughness: 1, metalness: .3 });
  const wheel = new THREE.CylinderGeometry(.48, .48, .24, 12);
  wheel.rotateZ(Math.PI / 2);
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const tyre = new THREE.TorusGeometry(.36, .12, 6, 14); tyre.rotateY(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(.22, .22, .25, 10); rim.rotateZ(Math.PI / 2);
  const bounds = [];
  for (const wreck of wrecks) {
    const root = new THREE.Group();
    root.userData.staticWreckId = wreck.id;
    root.position.set(wreck.x, groundHeight(wreck.x, wreck.z), wreck.z); root.rotation.y = wreck.heading;
    scene.add(root);
    const part = (x, y, z, w, h, d, material = metal) => box(x, y, z, w, h, d, material, true, root);
    const beam = (a, b, radius, material) => {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
      const object = mesh(beamGeometry, material, ...start.clone().add(end).multiplyScalar(.5).toArray(), true, root);
      object.scale.set(radius, start.distanceTo(end), radius);
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    };
    if (wreck.type === 'truck') {
      part(0, .63, 0, 1.8, .25, 4.8, burned);
      part(0, .99, -1.65, .96, .44, 1.1, burned);
      part(.71, 1.14, -1.65, .24, .55, 1.2).rotation.z = -.3;
      part(0, 1.11, -.45, 1.9, .8, 1.25);
      part(0, 2.04, -.44, 2, .14, 1.36, burned).rotation.z = -.1;
      for (const side of [-1, 1]) {
        beam([side * .89, 1.38, -1.04], [side * .89, 2.03, -.99], .045, burned);
        beam([side * .89, 1.38, .11], [side * .89, 2.03, .17], .045, burned);
        for (const z of [-1.6, 1.65]) {
          if (!(side < 0 && z < 0)) mesh(tyre, burned, side * 1.02, .48, z, true, root);
          const hub = mesh(rim, metal, side * 1.02, side < 0 && z < 0 ? .25 : .48, z, true, root);
          if (side < 0 && z < 0) hub.rotation.z = .3;
        }
        for (let plank = 0; plank < 3; plank++) {
          const board = part(side * .94, 1.06 + plank * .23, 1.25 + plank * .15, .12, .17, 2.1 + plank * .17, timber);
          board.rotation.x = side * (plank - 1) * .06;
        }
      }
      for (let i = 0; i < 6; i++) part(-.77 + i * .3, .92, 1.5, .26, .12, 2.6, timber);
      part(-1.5, .09, -.65, .85, .09, 1.15, burned).rotation.y = .6;
      part(0, 1.1, -2.31, 1.6, .6, .08, burned);
      for (let i = 0; i < 9; i++) part(-.65 + i * .16, 1.1, -2.37, .045, .43, .04);
    } else {
      part(0, .75, 0, 2.45, .78, 4.1);
      for (const side of [-1, 1]) {
        part(side * 1.27, .49, 0, .38, .69, 4.25, burned);
        for (const z of [-1.45, -.5, .45, 1.4]) {
          const roadwheel = mesh(wheel, metal, side * 1.5, .45, z, true, root); roadwheel.scale.set(1, .7, .7);
        }
      }
      const turret = part(.17, 1.52, -.15, 1.5, .75, 1.65); turret.rotation.set(.1, -.35, -.17);
      beam([.2, 1.61, -.8], [-.65, 1.15, -3.1], .085, burned);
      part(.23, 1.97, -.14, .7, .09, .65, burned).rotation.x = -.9;
      part(1.7, .12, 1.45, .45, .12, 1.1, burned).rotation.y = .6;
    }
    root.updateMatrixWorld(true);
    const aabb = new THREE.Box3().setFromObject(root);
    const obstacle = { id: `wreck-${wreck.id}`, minX: aabb.min.x, maxX: aabb.max.x, minZ: aabb.min.z,
      maxZ: aabb.max.z, height: aabb.max.y };
    obstacles.push(obstacle); bounds.push({ ...wreck, ...obstacle });
  }
  return bounds;
}
