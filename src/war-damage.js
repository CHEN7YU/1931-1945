import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHELL_CRATERS, CRATER_EDGE, STATIC_WRECKS, craterHeight } from './war-damage-layout.js';
import { CHI_HA } from './chi-ha.js';
import { createVehicleRenderer } from './vehicle-renderer.js';

export function agedSceneryTexture(kind) {
  if (kind !== 'case' && kind !== 'wreck') throw new Error(`Unknown aged scenery surface: ${kind}`);
  const size = 128, pixels = new Uint8Array(size * size * 4);
  const noise = (x, y) => {
    let n = Math.imul(x + 1937, 374761393) + Math.imul(y + 83, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const smoothNoise = (x, y, scale) => {
    const px = x / scale, py = y / scale, ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = noise(ix, iy) * (1 - u) + noise(ix + 1, iy) * u;
    const b = noise(ix, iy + 1) * (1 - u) + noise(ix + 1, iy + 1) * u;
    return a * (1 - v) + b * v;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = smoothNoise(x, y, 22), mottled = smoothNoise(x + 91, y + 23, 7);
    const grain = noise(x + 311, y + 73) - .5;
    const dirt = Math.max(0, .54 - broad) * 15 + Math.max(0, .45 - mottled) * 8;
    const scuff = noise(Math.floor(x / 8) + 71, Math.floor(y / 3) + 7) > .94 && y % 3 === 0 ? 5 : 0;
    const base = kind === 'case' ? [88, 72, 57] : [58, 55, 50];
    const variation = (broad - .5) * 9 + (mottled - .5) * 8 + grain * 8 - dirt + scuff;
    const rust = kind === 'wreck' ? Math.max(0, mottled - .55) * 15 : 0;
    const offset = (y * size + x) * 4;
    pixels[offset] = base[0] + variation + rust;
    pixels[offset + 1] = base[1] + variation + rust * .3;
    pixels[offset + 2] = base[2] + variation - rust * .2;
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

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

function addTankWreckVisual(root) {
  const visual = new THREE.Group();
  visual.userData.staticTankVisual = true;
  const renderer = createVehicleRenderer(visual);
  renderer.update([{
    id: 'static-north-light-tank', type: 'tank', variant: CHI_HA.id, team: 'enemy',
    position: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0, turretYaw: 0,
    turretPitch: 0, trackDistance: 0, machineGuns: [], health: 0,
  }]);
  const batches = visual.children.filter(object => object.userData.wreckBatch);
  const material = batches[0]?.material;
  if (!material || material.vertexColors || material.map || material.normalMap ||
    batches.some(object => object.material !== material || !object.castShadow || !object.receiveShadow ||
      object.renderOrder !== 0)) throw new Error('Tank wreck batches cannot be safely combined');
  const parts = [], matrix = new THREE.Matrix4();
  for (const batch of batches) {
    const source = batch.geometry.index ? batch.geometry.toNonIndexed() : batch.geometry.clone();
    source.deleteAttribute('uv'); source.deleteAttribute('color');
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, matrix);
      parts.push(source.clone().applyMatrix4(matrix));
    }
    source.dispose();
  }
  const geometry = mergeGeometries(parts), staticMaterial = material.clone();
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Tank wreck geometry could not be combined');
  renderer.clear();
  const combined = new THREE.Mesh(geometry, staticMaterial);
  combined.castShadow = combined.receiveShadow = true;
  visual.add(combined);
  root.add(visual);
  return visual;
}

export function addStaticWrecks(scene, { mesh, box, obstacles, groundHeight, timber, wrecks = STATIC_WRECKS, weathered = false }) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x484338, roughness: .97, metalness: .55 });
  const burned = new THREE.MeshStandardMaterial({ color: 0x242421, roughness: 1, metalness: .3 });
  const busMetal = new THREE.MeshStandardMaterial({ color: 0x45433c, roughness: 1, metalness: .18 });
  const rubber = weathered ? new THREE.MeshStandardMaterial({ color: 0x292925, roughness: 1 }) : burned;
  if (weathered) {
    const map = agedSceneryTexture('wreck');
    for (const material of [metal, burned, busMetal]) {
      material.map = map;
      material.color.setHex(material === burned ? 0x99938c : 0xffffff);
      material.metalness = .08;
    }
  }
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
    const beam = (a, b, radius, material, solid = true) => {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
      const object = mesh(beamGeometry, material, ...start.clone().add(end).multiplyScalar(.5).toArray(), solid, root);
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
          if (!(side < 0 && z < 0)) mesh(tyre, rubber, side * 1.02, .48, z, true, root);
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
      if (weathered) {
        for (const side of [-1, 1]) {
          beam([side * .89, 1.38, -1.04], [side * .89, 1.38, .11], .025, burned, false);
          box(side * .955, 1.08, -.45, .012, .018, 1.05, burned, false, root);
          box(side * .955, 1.23, -.05, .012, .035, .12, burned, false, root);
          const arch = new THREE.TorusGeometry(.54, .035, 6, 18, Math.PI);
          arch.rotateY(Math.PI / 2);
          mesh(arch, burned, side * .99, .48, -1.6, false, root);
        }
        beam([0, 1.4, -1.03], [0, 2.01, -.99], .025, burned, false);
        beam([-1.02, .25, -1.6], [-.72, .58, -1.43], .035, burned, false);
        beam([-.72, .58, -1.43], [-.3, .56, -1.55], .035, burned, false);
      }
    } else if (wreck.type === 'bus') {
      part(0, .64, 0, 2, .22, 6, burned);
      part(0, 1.05, -.15, 2, .75, 4.8, busMetal);
      for (const [z, length, tilt] of [[-1.7, 1.5, -.04], [.05, 1.35, .1], [1.73, 1, -.12]]) {
        const roof = part(0, 2.48, z, 2.04, .12, length, burned);
        roof.rotation.z = tilt;
      }
      part(0, 1.05, -2.72, 1.65, .56, .65, busMetal);
      part(0, 1.04, 2.25, 1.9, .72, .12, busMetal);
      beam([-.9, 1.4, 2.25], [-.86, 2.38, 2.27], .045, burned);
      beam([.9, 1.4, 2.25], [.86, 2.38, 2.27], .045, burned);
      beam([-.86, 2.3, 2.27], [.86, 2.3, 2.27], .04, burned);
      for (const side of [-1, 1]) {
        for (const z of [-2.32, -1.35, -.35, .65, 1.65, 2.18])
          beam([side * .94, 1.42, z], [side * .94, 2.43, z + .04], .045, burned);
        for (const z of [-1.6, .3, 1.55]) {
          const scorch = part(side * 1.008, 1.06, z, .025, .48, .55, weathered ? busMetal : burned);
          scorch.rotation.x = z * .07;
        }
        for (const z of [-1.9, 1.65]) {
          if (!(side < 0 && z < 0)) mesh(tyre, rubber, side * 1.08, .48, z, true, root);
          mesh(rim, metal, side * 1.08, side < 0 && z < 0 ? .25 : .48, z, true, root);
        }
      }
      part(0, .98, -3.08, 1.65, .48, .08, burned);
      for (let i = 0; i < 7; i++) part(-.57 + i * .19, .98, -3.13, .045, .35, .04, metal);
      part(-1.35, .08, .6, .7, .07, 1.25, burned).rotation.y = .45;
      if (weathered) {
        for (const side of [-1, 1]) {
          box(side * 1.01, 1.36, -.05, .025, .035, 4.35, burned, false, root);
          box(side * 1.01, .81, -.05, .025, .035, 4.35, burned, false, root);
          for (const z of [-1.9, 1.65]) {
            const arch = new THREE.TorusGeometry(.55, .045, 6, 18, Math.PI);
            arch.rotateY(Math.PI / 2);
            mesh(arch, burned, side * 1.02, .48, z, false, root);
          }
        }
        beam([0, 1.4, -2.32], [0, 2.34, -2.28], .035, burned, false);
        beam([-.9, 2.3, -2.3], [.9, 2.3, -2.3], .035, burned, false);
        box(0, 1.32, -2.67, 1.55, .06, .48, busMetal, false, root);
        beam([-1.08, .25, -1.9], [-.78, .56, -1.7], .04, burned, false);
        beam([-.78, .56, -1.7], [-.35, .55, -1.85], .04, burned, false);
        const lamp = new THREE.SphereGeometry(.11, 10, 7);
        for (const side of [-1, 1]) mesh(lamp, burned, side * .72, 1.14, -3.03, false, root);
      }
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
    if (wreck.id === 'north-light-tank' && wreck.type === 'tank' && !weathered) {
      for (const object of root.children) {
        object.visible = false;
        object.userData.collisionOnly = true;
      }
      const hull = part(0, .9, 0, CHI_HA.width, 1.2, CHI_HA.length);
      hull.visible = false; hull.userData.collisionOnly = true;
      const visual = addTankWreckVisual(root);
      root.updateMatrixWorld(true);
      aabb.union(new THREE.Box3().setFromObject(hull));
      aabb.union(new THREE.Box3().setFromObject(visual));
    }
    const obstacle = { id: `wreck-${wreck.id}`, minX: aabb.min.x, maxX: aabb.max.x, minZ: aabb.min.z,
      maxZ: aabb.max.z, height: aabb.max.y };
    obstacles.push(obstacle); bounds.push({ ...wreck, ...obstacle });
  }
  return bounds;
}
