import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { circleBlocked, createNavigator } from './core.js';
import { createDoorWorld } from './door-world.js';
import { createCivilianCharacterFactory } from './civilian-character.js';
import { advanceCivilianMotion } from './civilian-motion.js';
import { staticGeometryBatches } from './static-scene-batches.js';
import { obstacleLookup } from './spatial.js';
import { createSihangFlag } from './sihang-flag.js';
import { createSihangCity } from './sihang-city.js';
import {
  SIHANG_WAREHOUSE as W, SIHANG_RIVER as R, SIHANG_BRIDGE as B,
  SIHANG_CAPTURE_AREA, SIHANG_STAIRWELLS, SIHANG_STAIR_ROUTES,
  SIHANG_LEVELS, SIHANG_NORTH_WINDOWS, SIHANG_EAST_DEFENSE_WINDOWS, SIHANG_FIRING_POSTS,
  sihangStairHeight, sihangRiverBounds, sihangSouthBank,
} from './sihang-layout.js';

const within = (x, z, rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
const bridgeHeight = z => 1.15 * Math.sin(Math.PI * THREE.MathUtils.clamp((z - R.northZ) / 24, 0, 1));
const levels = SIHANG_LEVELS;

function createDamagedPlaster() {
  const size = 512, pixels = new Uint8Array(size * size * 4);
  let seed = 1937;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const noiseFields = [8, 16, 32].map(count => ({ count,
    values: Float32Array.from({ length: count * count }, random) }));
  const noiseAt = (field, x, y) => {
    const u = x / size * field.count, v = y / size * field.count;
    const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const sample = (dx, dy) => field.values[((iy + dy) % field.count) * field.count + (ix + dx) % field.count];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(sample(0, 0), sample(1, 0), sx),
      THREE.MathUtils.lerp(sample(0, 1), sample(1, 1), sx), sy);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = random() * 12;
    const patch = noiseAt(noiseFields[0], x, y) * .6 + noiseAt(noiseFields[1], x, y) * .28 +
      noiseAt(noiseFields[2], x, y) * .12 > .59;
    const mortar = y % 3 === 0 || (x + (Math.floor(y / 3) % 2) * 4) % 8 === 0;
    const color = patch ? (mortar ? [132, 125, 109] : [135, 101, 78]) : [190, 185, 168];
    const i = (y * size + x) * 4;
    pixels.set([color[0] - noise, color[1] - noise, color[2] - noise, 255], i);
  }
  for (let i = 0; i < 850; i++) {
    const x = Math.floor(random() * size), y = Math.floor(random() * size), radius = i % 6 === 0 ? 2 : 1;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius || x + dx < 0 || y + dy < 0 || x + dx >= size || y + dy >= size) continue;
      pixels.set([66, 61, 51, 255], ((y + dy) * size + x + dx) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4;
  texture.repeat.set(.055, .055); texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .96 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vSihangWallPosition;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvSihangWallPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vSihangWallPosition;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        diffuseColor *= texture2D(map, vec2((vSihangWallPosition.x + vSihangWallPosition.z) * 0.055,
          vSihangWallPosition.y * 0.055));
      #endif`);
  };
  material.customProgramCacheKey = () => 'sihang-continuous-world-plaster-v1';
  return material;
}

function createWarehouseName() {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const context = canvas?.getContext?.('2d');
  let texture;
  if (context) {
    canvas.width = 1024; canvas.height = 128;
    context.font = 'bold 112px SimSun, serif'; context.textAlign = 'center';
    context.fillStyle = 'rgba(45,42,34,0.9)';
    [...'四行倉庫'].forEach((letter, index) => context.fillText(letter, 128 + index * 256, 105));
    texture = new THREE.CanvasTexture(canvas);
  } else texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(25, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.name = 'sihang-original-warehouse-lettering';
  mesh.userData.sihangFeature = 'warehouse-name';
  mesh.position.set(-36.42, 24.4, -25); mesh.rotation.y = -Math.PI / 2;
  return mesh;
}

export function makeSihangBattlefield(scene, surface) {
  const solids = [], obstacles = [], smoke = [], flags = [], civilians = [];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const plates = [0, 1, 2].map(axis => {
    const geometry = boxGeometry.clone();
    geometry.setIndex(Array.from(boxGeometry.index.array.slice(axis * 12, axis * 12 + 12)));
    geometry.clearGroups();
    return geometry;
  });
  const decorativeFaces = [12, 30].map(offset => {
    const geometry = boxGeometry.clone();
    geometry.setIndex(Array.from(boxGeometry.index.array.slice(offset, offset + 6)));
    geometry.clearGroups();
    return geometry;
  });
  const rubbleGeometry = new THREE.TetrahedronGeometry(.7);
  const intact = new THREE.Group(), rubble = new THREE.Group();
  intact.name = 'sihang-warehouse-standing'; rubble.name = 'sihang-warehouse-demolished';
  scene.add(intact, rubble);
  const town = { pieces: [], buildings: [], covers: [], streets: [], passages: [], fortifications: [], obstacles };
  const materials = {
    brick: surface('brick', 0x7d7770, 1.4),
    concrete: surface('paving', 0x99978c, 2),
    street: surface('paving', 0x676863, 3),
    earth: surface('earth', 0x81796a, 4),
    wood: surface('timber', 0x56493c, 2),
    iron: new THREE.MeshStandardMaterial({ color: 0x373d3c, roughness: .8, metalness: .35 }),
    plaster: surface('plaster', 0xb6ac93, 2),
    dark: surface('brick', 0x363531, 2),
  };
  const pending = new Map(), standingObstacles = [], standingSolids = [];
  function box(x, y, z, w, h, d, material, { parent = scene, block = false, feature } = {}) {
    // Thin decorative plates need only their two broad faces; tactical cover keeps all six faces.
    const dimensions = [w, h, d], minimum = Math.min(...dimensions);
    const axis = dimensions.indexOf(minimum);
    let geometry = !block && minimum / Math.max(...dimensions) < .12 ? plates[axis] : boxGeometry;
    if (!block && feature === 'sihang-city') {
      if (h < .5 && w < 1 && d < 1) geometry = rubbleGeometry;
      else if (axis === 2 && d < .15) geometry = decorativeFaces[1];
      else if (axis === 1 && h < .31) geometry = decorativeFaces[0];
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true;
    if (feature) mesh.userData.sihangFeature = feature;
    parent.add(mesh);
    if (!pending.has(parent)) pending.set(parent, []);
    pending.get(parent).push(mesh);
    if (block) {
      const obstacle = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
        minY: y - h / 2, baseY: y - h / 2, height: y + h / 2 };
      obstacles.push(obstacle);
      if (parent === intact) standingObstacles.push(obstacle);
      town.pieces.push({ x, y, z, w, h, d, wall: true });
    }
    return mesh;
  }
  function slab(minX, maxX, minZ, maxZ, y, parent = intact) {
    box((minX + maxX) / 2, y - .12, (minZ + maxZ) / 2,
      maxX - minX, .24, maxZ - minZ, materials.concrete, { parent, block: true });
    obstacles.at(-1).walkable = true;
  }
  // Every strip uses the same analytic river as safety, ray clipping and foot support.
  const riverVertices = [], riverIndices = [], bankVertices = [[], []], bankIndices = [];
  const riverBlocks = [];
  for (let i = 0; i <= 108; i++) {
    const x = -108 + i * 2, bounds = sihangRiverBounds(x);
    riverVertices.push(x, R.waterY, bounds.northZ, x, R.waterY, bounds.southZ);
    bankVertices[0].push(x, 0, -108, x, 0, bounds.northZ);
    bankVertices[1].push(x, 0, bounds.southZ, x, 0, 108);
    if (i) {
      const j = i * 2;
      riverIndices.push(j - 2, j - 1, j, j - 1, j + 1, j);
      bankIndices.push(j - 2, j - 1, j, j - 1, j + 1, j);
    }
    if (i === 108 || x >= 44 && x < 52) continue;
    const end = sihangRiverBounds(x + 2);
    // Outer envelopes conservatively close all water cells; no chord supports a shortcut.
    const north = Math.min(bounds.northZ, end.northZ), south = Math.max(bounds.southZ, end.southZ);
    const collider = { minX: x, maxX: x + 2, minZ: north, maxZ: south, minY: -10, height: 40, water: true };
    riverBlocks.push(collider);
    for (const bank of ['northZ', 'southZ']) {
      const middle = sihangRiverBounds(x + 1)[bank], slope = (end[bank] - bounds[bank]) / 2;
      const rail = box(x + 1, 1.05, middle, Math.hypot(2, 2 * slope), .1, .12, materials.iron);
      rail.rotation.y = -Math.atan(slope);
      box(x + 1, -.8, middle, 2.01, 1.6, .5, materials.concrete);
      box(x, .52, bounds[bank], .1, 1.04, .1, materials.iron);
      obstacles.push({ minX: x, maxX: x + 2, minZ: Math.min(bounds[bank], end[bank]) - .3,
        maxZ: Math.max(bounds[bank], end[bank]) + .3, minY: -.2, height: 1.1, bankRail: true });
    }
  }
  function strip(vertices, indices, material, name) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const uv = [];
    for (let i = 0; i < vertices.length; i += 3) uv.push(vertices[i] / 4, vertices[i + 2] / 4);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.receiveShadow = true; scene.add(mesh);
    return mesh;
  }
  solids.push(strip(bankVertices[0], bankIndices, materials.earth, 'sihang-north-dry-bank'));
  solids.push(strip(bankVertices[1], bankIndices, materials.street, 'sihang-south-dry-bank'));
  for (const z of [-55, 43, 82]) {
    box(0, -.025, z, 216, .05, 8, materials.street);
    town.streets.push({ x: 0, z, width: 216, depth: 8 });
  }
  for (const x of [-60, 48, 85]) {
    box(x, -.02, -50, 10, .04, 116, materials.street);
    town.streets.push({ x, z: -50, width: 10, depth: 116 });
  }
  const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x354f48, roughness: .48, metalness: .12 });
  const water = strip(riverVertices, riverIndices, waterMaterial, 'suzhou-river');
  obstacles.push(...riverBlocks);
  // A continuous arched walking surface, not a flat collider floating above a decorative arch.
  const bridgeVertices = [], bridgeIndices = [];
  for (let step = 0; step <= 48; step++) {
    const z = 8 + step / 2, y = bridgeHeight(z);
    bridgeVertices.push(44, y, z, 52, y, z);
    if (step) {
      const i = step * 2;
      bridgeIndices.push(i - 2, i, i - 1, i - 1, i, i + 1);
    }
    if (step < 48) {
      const middleZ = z + .25, middleY = bridgeHeight(middleZ);
      for (const x of [44, 52]) {
        box(x, middleY - .33, middleZ, .35, .65, .51, materials.concrete);
        box(x, middleY + 1, middleZ, .14, .14, .51, materials.iron);
        if (step % 4 === 0) box(x, middleY + .5, middleZ, .12, 1.1, .12, materials.iron);
        obstacles.push({ minX: x - .12, maxX: x + .12, minZ: z, maxZ: z + .5,
          minY: middleY + .15, height: middleY + 1.1 });
      }
    }
  }
  const bridgeGeometry = new THREE.BufferGeometry();
  bridgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bridgeVertices, 3));
  bridgeGeometry.setIndex(bridgeIndices); bridgeGeometry.computeVertexNormals();
  const bridgeDeck = new THREE.Mesh(bridgeGeometry, materials.concrete);
  bridgeDeck.name = 'sihang-arched-bridge-deck'; bridgeDeck.receiveShadow = true;
  scene.add(bridgeDeck); solids.push(bridgeDeck);
  for (const x of [44, 52]) {
    const arch = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) =>
      new THREE.Vector3(x, bridgeHeight(8 + i * 1.5) - .55, 8 + i * 1.5)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(arch, 32, .32, 6, false), materials.concrete);
    scene.add(mesh); solids.push(mesh);
  }

  const floorRects = [];
  for (const y of levels) {
    if (!y) {
      slab(W.minX, W.maxX, W.minZ, W.maxZ, y);
      continue;
    }
    let strips = [{ ...W.bounds }];
    for (const shaft of SIHANG_STAIRWELLS) strips = strips.flatMap(rect => {
      if (rect.maxX <= shaft.minX || rect.minX >= shaft.maxX || rect.maxZ <= shaft.minZ || rect.minZ >= shaft.maxZ)
        return [rect];
      const result = [];
      if (rect.minZ < shaft.minZ) result.push({ ...rect, maxZ: shaft.minZ });
      if (rect.maxZ > shaft.maxZ) result.push({ ...rect, minZ: shaft.maxZ });
      const minZ = Math.max(rect.minZ, shaft.minZ), maxZ = Math.min(rect.maxZ, shaft.maxZ);
      if (rect.minX < shaft.minX) result.push({ minX: rect.minX, maxX: shaft.minX, minZ, maxZ });
      if (rect.maxX > shaft.maxX) result.push({ minX: shaft.maxX, maxX: rect.maxX, minZ, maxZ });
      return result;
    });
    for (const rect of strips) {
      slab(rect.minX, rect.maxX, rect.minZ, rect.maxZ, y);
      floorRects.push({ ...rect, height: y });
    }
  }
  const turnLandings = [];
  for (const route of SIHANG_STAIR_ROUTES) {
    slab(route.landing.minX, route.landing.maxX, route.landing.minZ, route.landing.maxZ, route.landing.height);
    turnLandings.push(route.landing);
    for (const flight of route.flights) {
      const run = Math.abs(flight.end.z - flight.start.z), rise = flight.end.y - flight.start.y;
      const profile = new THREE.Shape();
      profile.moveTo(0, -.18); profile.lineTo(0, 0);
      for (let step = 0; step < flight.steps; step++) {
        profile.lineTo(run * step / flight.steps, rise * (step + 1) / flight.steps);
        profile.lineTo(run * (step + 1) / flight.steps, rise * (step + 1) / flight.steps);
      }
      profile.lineTo(run, rise - .18); profile.closePath();
      const geometry = new THREE.ExtrudeGeometry(profile, { depth: flight.width, bevelEnabled: false, steps: 1 });
      geometry.translate(0, 0, -flight.width / 2);
      geometry.rotateY(-Math.sign(flight.end.z - flight.start.z) * Math.PI / 2);
      geometry.translate(flight.start.x, flight.start.y, flight.start.z);
      const steps = new THREE.Mesh(geometry, materials.concrete);
      steps.castShadow = steps.receiveShadow = true; steps.userData.sihangFeature = 'closed-stair-flight';
      intact.add(steps); pending.get(intact).push(steps);
      for (const x of [flight.minX + .06, flight.maxX - .06]) {
        const beam = box(x, (flight.start.y + flight.end.y) / 2 - .3,
          (flight.start.z + flight.end.z) / 2, .12, .25, Math.hypot(run, rise),
          materials.iron, { parent: intact });
        beam.rotation.x = -Math.atan2(rise, flight.end.z - flight.start.z);
      }
    }
  }
  const breaches = [];
  const wallMaterial = createDamagedPlaster();
  function facade(axis, fixed, low, high, openings) {
    // Exact stepped outlines are both visible geometry and physical collision, not decals over walls.
    const bands = [0, W.roofY, ...openings.flatMap(hole => [hole.bottom, hole.top,
      ...(hole.irregular ? Array.from({ length: 9 }, (_, i) => hole.bottom + (hole.top - hole.bottom) * (i + 1) / 10) : [])])];
    bands.sort((a, b) => a - b);
    for (let i = 1; i < bands.length; i++) {
      const bottom = bands[i - 1], top = bands[i];
      if (top - bottom < .001) continue;
      const middle = (bottom + top) / 2;
      const gaps = openings.filter(h => middle > h.bottom && middle < h.top).map(h => {
        const fraction = (middle - h.bottom) / (h.top - h.bottom);
        const band = Math.min(9, Math.floor(fraction * 10));
        const left = h.irregular ? h.width * [.21, .08, .14, .02, .10, 0, .12, .04, .16, .24][band] : 0;
        const right = h.irregular ? h.width * [.12, .19, .04, .11, 0, .13, .06, .18, .07, .16][band] : 0;
        return { left: h.u - h.width / 2 + left, right: h.u + h.width / 2 - right };
      }).sort((a, b) => a.left - b.left);
      let cursor = low;
      function wall(left, right) {
        if (right - left < .001) return;
        const thickness = axis === 'x' && fixed === W.minZ ? .5 : .8;
        box(axis === 'x' ? (left + right) / 2 : fixed, middle,
          axis === 'x' ? fixed : (left + right) / 2,
          axis === 'x' ? right - left : thickness, top - bottom, axis === 'x' ? thickness : right - left,
          wallMaterial, { parent: intact, block: true });
      }
      for (const gap of gaps) { wall(cursor, gap.left); cursor = gap.right; }
      wall(cursor, high);
    }
    for (const h of openings) {
      breaches.push({ ...h, axis, x: axis === 'x' ? h.u : fixed, z: axis === 'x' ? fixed : h.u,
        y: (h.bottom + h.top) / 2, floor: Math.floor(h.bottom / W.floorHeight), blown: !!h.irregular });
      if (h.kind === 'window') {
        // Frames stay at the edges so the existing standing defense posts retain clear sight lines.
        box(axis === 'x' ? h.u : fixed, h.bottom - .08, axis === 'x' ? fixed : h.u,
          axis === 'x' ? h.width + .2 : 1, .14, axis === 'x' ? 1 : h.width + .2,
          materials.concrete, { parent: intact, block: true });
      }
    }
  }
  const northOpenings = [{ id: 'north-gate', u: -20, width: 7, bottom: 0, top: 3.4, kind: 'gate' }];
  for (const u of SIHANG_NORTH_WINDOWS) northOpenings.push({
    id: `north-defense-${u}`, u, width: 4.8, bottom: W.floorHeight + .8, top: W.floorHeight + 4.7, kind: 'window',
  });
  northOpenings.push({ id: 'north-shell-upper', u: 8, width: 3.4, bottom: 18.2, top: 23.2, kind: 'breach', irregular: true });
  facade('x', W.minZ, W.minX, W.maxX, northOpenings);
  const riverWindows = [];
  for (let floor = 0; floor < 3; floor++) for (const u of [-24, -16, -8, 0, 8, 16, 24])
    riverWindows.push({ id: `river-window-${floor}-${u}`, u, width: 2.6,
      bottom: floor * W.floorHeight + .8, top: floor * W.floorHeight + 4.7, kind: 'window' });
  facade('x', W.maxZ, W.minX, W.maxX, riverWindows);
  const eastOpenings = [];
  for (let floor = 0; floor < 3; floor++) for (const u of floor === 1 ? SIHANG_EAST_DEFENSE_WINDOWS : [-38, -30, -22, -14])
    eastOpenings.push({ id: `east-${floor}-${u}`, u, width: floor === 0 && (u === -38 || u === -14) ? 4.8 : 2.5,
      bottom: floor * W.floorHeight + (floor === 0 && (u === -38 || u === -14) ? 0 : .8),
      top: floor * W.floorHeight + 4.7, kind: floor === 0 && (u === -38 || u === -14) ? 'door' : 'window' });
  facade('z', W.maxX, W.minZ, W.maxZ, eastOpenings);
  facade('z', W.minX, W.minZ, W.maxZ, [
    { id: 'west-shell-middle', u: -29, width: 3.5, bottom: 10.1, top: 14.8, kind: 'breach', irregular: true },
    { id: 'west-shell-upper', u: -18, width: 2.6, bottom: 18.1, top: 23.8, kind: 'breach', irregular: true },
  ]);
  const partitions = [];
  for (let floor = 0; floor < 3; floor++) {
    const base = floor * W.floorHeight;
    for (const x of [-12, 4]) for (const z of [-33, -17]) {
      box(x, base + W.floorHeight / 2, z, .65, W.floorHeight, .65, materials.concrete, { parent: intact, block: true });
      box(x, base + W.floorHeight - .3, -25, .48, .6, 32, materials.concrete, { parent: intact, block: true });
    }
    const height = W.floorHeight - .6;
    for (const [left, right] of [[-12, -4], [0, 12]]) {
      box((left + right) / 2, base + height / 2, -20, right - left, height, .3,
        materials.plaster, { parent: intact, block: true });
      partitions.push({ floor, minX: left, maxX: right, minZ: -20.15, maxZ: -19.85 });
    }
    for (const x of [-12, 12]) for (const [north, south] of [[-39, -35], [-13, -9]]) {
      box(x, base + height / 2, (north + south) / 2, .3, height, south - north,
        materials.plaster, { parent: intact, block: true });
      partitions.push({ floor, minX: x - .15, maxX: x + .15, minZ: north, maxZ: south });
    }
  }
  // Strong continuous cornices and corners distinguish a surviving masonry warehouse.
  for (const z of [W.minZ, W.maxZ]) {
    box(W.x, W.roofY - .1, z, W.width + 1, .35, 1.15, materials.concrete, { parent: intact, block: true });
    box(W.x, W.roofY + .4, z, W.width, .75, .6, wallMaterial, { parent: intact, block: true });
  }
  for (const x of [W.minX, W.maxX]) {
    box(x, W.roofY - .1, W.z, 1.15, .35, W.depth, materials.concrete, { parent: intact, block: true });
    box(x, W.roofY + .4, W.z, .6, .75, W.depth, wallMaterial, { parent: intact, block: true });
  }
  for (const x of [-28, -12]) {
    for (let row = 0; row < 3; row++) for (let bag = 0; bag < 7; bag++)
      box(x + (bag - 3) * .75 + (row % 2) * .18, .2 + row * .34, -49.4,
        .8, .36, .55, materials.earth, { block: true });
    for (const side of [-1, 1]) for (let row = 0; row < 2; row++) for (let bag = 0; bag < 3; bag++)
      box(x + side * 2.7, .2 + row * .34, -48.5 + bag * .7,
        .55, .36, .8, materials.earth, { block: true });
    town.fortifications.push({ id: `north-gate-sandbags-${x}`, x, z: -49.4, use: 'machine-gun-cover' });
  }
  // Bounded debris sits outside doorways, squad origins and the demolition assembly space.
  for (let i = 0; i < 36; i++) {
    const x = -34 + (i % 12) * 5.3, z = i < 12 ? -44.5 : i < 24 ? -6 : -46;
    if (Math.abs(x) < 7 && z < -42) continue;
    const piece = box(x, .12, z, .4 + i % 3 * .15, .24, .45, materials.dark);
    piece.rotation.y = i * 2.39;
  }
  const warehouse = { id: 'sihang-warehouse', ...W, floors: 3, accessible: true,
    historicalAdaptation: 'three-playable-storeys', breaches, stairwells: SIHANG_STAIRWELLS,
    stairRoutes: SIHANG_STAIR_ROUTES, firingPosts: SIHANG_FIRING_POSTS, partitions, intact, rubble, destructible: false };
  town.buildings.push(warehouse);
  intact.add(createWarehouseName());
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = '#33342e'; context.font = 'bold 76px serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText('四　行　仓　库', 512, 48);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(27, .5), labelMaterial);
    label.name = 'sihang-warehouse-name'; label.position.set(W.minX - .41, W.roofY - .55, W.z);
    label.rotation.y = -Math.PI / 2; intact.add(label);
  }

  const city = createSihangCity({ scene, box, town, materials });

  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x557ca5, roughness: .8 });
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, .08, 16), markerMaterial);
  marker.position.set(-4, .05, -25); intact.add(marker); flags.push(marker);
  const flagAnimation = createSihangFlag(materials.iron), roofFlag = flagAnimation.group;
  roofFlag.position.set(-4, W.roofY, -12); intact.add(roofFlag);
  warehouse.roofFlag = roofFlag;

  // Demolition is a visibility switch over prebuilt assets, not an ordinary bullet-damage system.
  for (let i = 0; i < 84; i++) {
    const x = -34 + (i * 7.73 % 60), z = -40 + (i * 5.91 % 30);
    const chunk = box(x, .3 + (i % 5) * .19, z, 1.3 + i % 3, .6 + i % 4 * .3,
      1.2 + i % 2, i % 2 ? materials.dark : materials.brick, { parent: rubble });
    chunk.rotation.set((i % 3) * .13, i * .73, (i % 4) * .12);
  }
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x252524, transparent: true, opacity: .7, depthWrite: false });
  const smokeGeometry = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 8; i++) {
    const puff = new THREE.Mesh(smokeGeometry, smokeMaterial);
    puff.position.set(-18 + i * 4, 5 + i * 1.9, -26 + Math.sin(i) * 7);
    puff.scale.setScalar(3.5 + i * .35); rubble.add(puff);
  }
  rubble.visible = false;
  const staticRendering = { sources: 0, batches: 0, triangles: 0 };
  scene.updateMatrixWorld(true);
  for (const [parent, objects] of pending) {
    staticRendering.sources += objects.length;
    // Bounded 64m cells keep dense street blocks culled, with fewer material submissions.
    const regions = new Map();
    for (const object of objects) {
      const key = `${Math.floor(object.position.x / 64)},${Math.floor(object.position.z / 64)}`;
      if (!regions.has(key)) regions.set(key, []);
      regions.get(key).push(object);
    }
    for (const region of regions.values()) for (const [material, cells] of staticGeometryBatches(region)) {
      for (const geometries of cells.values()) {
        const geometry = mergeGeometries(geometries);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = mesh.receiveShadow = true; mesh.userData.staticSceneBatch = true;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere(); parent.add(mesh);
        staticRendering.batches++;
        staticRendering.triangles += geometry.attributes.position.count / 3;
        if (parent !== rubble) solids.push(mesh);
        if (parent === intact) standingSolids.push(mesh);
        for (const baked of geometries) baked.dispose();
      }
    }
  }
  const doorSystem = createDoorWorld(scene, town, obstacles, solids, materials.wood, materials.iron);
  const movementLookup = obstacleLookup(obstacles, 3.5);
  const civiliansFactory = createCivilianCharacterFactory();
  for (let i = 0; i < 36; i++) {
    const age = i % 9 === 0 ? 'child' : i % 9 === 1 ? 'elderly' : 'adult';
    const person = civiliansFactory.create(i, age, i % 2 ? 'man' : 'woman', 'none');
    let route;
    if (i < 24) {
      const x = -98 + i * 8.3;
      route = [{ x, z: sihangRiverBounds(x).southZ + 3.5 },
        { x: x + (i % 2 ? 1.5 : 0), z: sihangRiverBounds(x + (i % 2 ? 1.5 : 0)).southZ + 3.5 }];
    } else {
      const home = town.buildings.filter(building => building.id.startsWith('concession-shop'))[(i - 24) % 7];
      route = [{ x: home.x, z: 48 + (i % 2) * 2 }, { x: home.x, z: home.z - 1 }];
    }
    Object.assign(person.userData, { civilianId: i, ageGroup: age, presentation: i % 2 ? 'man' : 'woman',
      carrying: 'none', walkPhase: i * .71, dead: false, health: 100, populationKind: 'resident',
      route, waypoint: 1, waiting: i < 24, startX: route[0].x, startZ: route[0].z });
    person.position.set(route[0].x, 0, route[0].z); person.rotation.y = 0;
    scene.add(person); civilians.push(person);
  }
  let ruined = false;
  function isDeepWater(x, z) {
    if (![x, z].every(Number.isFinite)) return false;
    const bounds = sihangRiverBounds(x);
    return z > bounds.northZ && z < bounds.southZ && (x < 44 || x > 52);
  }
  function groundHeight(x, z) {
    if (![x, z].every(Number.isFinite)) throw new RangeError('Sihang ground requires finite coordinates');
    const bounds = sihangRiverBounds(x);
    if (z >= bounds.northZ && z <= bounds.southZ) return x >= 44 && x <= 52 ? bridgeHeight(z) : R.waterY;
    return 0;
  }
  const stairFlights = SIHANG_STAIR_ROUTES.flatMap(route => route.flights);
  function walkHeight(x, z, referenceY = groundHeight(x, z), step = .25) {
    if (![x, z, referenceY, step].every(Number.isFinite) || step < 0)
      throw new RangeError('Sihang walk height requires finite coordinates and a nonnegative step');
    let height = groundHeight(x, z);
    if (ruined || !within(x, z, W)) return height;
    for (const rect of floorRects)
      if (within(x, z, rect) && rect.height <= referenceY + step && rect.height > height) height = rect.height;
    for (const landing of turnLandings)
      if (within(x, z, landing) && landing.height <= referenceY + step && landing.height > height) height = landing.height;
    for (const flight of stairFlights) if (within(x, z, flight)) {
      const candidate = sihangStairHeight(flight, z);
      if (candidate <= referenceY + step && candidate > height) height = candidate;
    }
    return height;
  }
  function movementHeightAt(x, z, referenceY, radius, movementObstacles, bodyHeight) {
    if (![x, z, referenceY, radius].every(Number.isFinite) || radius < 0 || isDeepWater(x, z)) return null;
    const y = walkHeight(x, z, referenceY);
    const candidates = movementObstacles === obstacles && radius <= 3.5 ? movementLookup.at(x, z) : movementObstacles;
    if (y - referenceY > .26 || referenceY - y > .32 ||
      circleBlocked(x, z, radius, candidates.filter(o => !o.walkable || o.height > y + .25), y, bodyHeight)) return null;
    if (!ruined && stairFlights.some(flight => within(x, z, flight) &&
      sihangStairHeight(flight, z) > y + .5 && sihangStairHeight(flight, z) - .18 < y + bodyHeight)) return null;
    return y;
  }
  function moveInfantry(position, dx, dz, radius = .42, movementObstacles = obstacles, bodyHeight = 1.75) {
    if (![position.x, position.y, position.z, dx, dz, radius].every(Number.isFinite) || radius < 0)
      throw new RangeError('Sihang infantry movement requires finite coordinates and a nonnegative radius');
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .12));
    const attempt = (x, z) => {
      const y = movementHeightAt(x, z, position.y, radius, movementObstacles, bodyHeight);
      if (y === null) return;
      position.set ? position.set(x, y, z) : Object.assign(position, { x, y, z });
    };
    for (let i = 0; i < count; i++) {
      attempt(position.x + dx / count, position.z);
      attempt(position.x, position.z + dz / count);
    }
    return position;
  }
  const navigators = new Map();
  function physicalConnector(start, goal, sameLevel = false) {
    const feet = new THREE.Vector3(start.x, start.y ?? groundHeight(start.x, start.z), start.z);
    const count = Math.max(1, Math.ceil(Math.hypot(goal.x - start.x, goal.z - start.z) / .12));
    const path = [];
    for (let i = 1; i <= count; i++) {
      const x = start.x + (goal.x - start.x) * i / count;
      const z = start.z + (goal.z - start.z) * i / count;
      moveInfantry(feet, x - feet.x, z - feet.z, .42);
      if (Math.hypot(feet.x - x, feet.z - z) > .001 ||
        sameLevel && Math.abs(feet.y - start.y) > .025) return [];
      path.push({ x: feet.x, y: feet.y, z: feet.z });
    }
    return Math.abs(feet.y - goal.y) <= .025 ? path : [];
  }
  function floorPath(start, goal, level) {
    const finishAtGoal = path => {
      if (!path.length) return [];
      const last = path[path.length - 1];
      if (Math.hypot(last.x - goal.x, last.z - goal.z) < .001) return path;
      const finish = physicalConnector(last,
        { ...goal, y: level ? levels[level] : groundHeight(goal.x, goal.z) }, level > 0);
      return finish.length ? [...path, ...finish] : [];
    };
    let navigator = navigators.get(level);
    if (!navigator) {
      const y = levels[level];
      const projected = doorSystem.navigationObstacles
        .filter(o => (!ruined || !standingObstacles.includes(o)) &&
          (o.minY ?? -Infinity) < y + 1.75 && (o.height ?? Infinity) > y + .025)
        .map(o => ({ ...o, minY: -10, height: 40 }));
      if (level && !ruined) {
        projected.push(
          { minX: -108, maxX: W.minX, minZ: -108, maxZ: 108 },
          { minX: W.maxX, maxX: 108, minZ: -108, maxZ: 108 },
          { minX: -108, maxX: 108, minZ: -108, maxZ: W.minZ },
          { minX: -108, maxX: 108, minZ: W.maxZ, maxZ: 108 },
        );
      }
      if (!ruined) for (const stair of SIHANG_STAIRWELLS) projected.push({ ...stair, height: 40 });
      // Leave room for the axis-separated 12cm movement substeps around surviving masonry corners.
      navigator = createNavigator(projected, 1, .55);
      navigators.set(level, navigator);
    }
    const path = navigator(start, goal);
    if (!path.length && navigator.stats.reason === 'blocked-start' && !ruined) {
      // Only bridge the artificial clearance collar of a stair cutout, never a real wall or an unsupported cell.
      const candidates = SIHANG_STAIRWELLS.flatMap(stair => [
        { x: stair.minX - .6, z: start.z }, { x: stair.maxX + .6, z: start.z },
        { x: start.x, z: stair.minZ - .6 }, { x: start.x, z: stair.maxZ + .6 },
      ]).map(p => ({ ...p, y: levels[level],
        distance: Math.hypot(p.x - start.x, p.z - start.z) }))
        .filter(p => p.distance > .001 && p.distance <= 1.2)
        .sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) {
        const prefix = physicalConnector(start, candidate, true);
        if (!prefix.length) continue;
        const remainder = navigator(candidate, goal);
        if (!remainder.length) continue;
        return finishAtGoal([...prefix, ...remainder.map(p => ({ ...p, y: level ? levels[level] : groundHeight(p.x, p.z) }))]);
      }
    }
    return finishAtGoal(path.map(p => ({ ...p, y: level ? levels[level] : groundHeight(p.x, p.z) })));
  }
  doorSystem.onNavigationChanged = () => { navigators.clear(); movementLookup.rebuild(); };
  function stairAt(point) {
    if (ruined || ![point?.x, point?.y, point?.z].every(Number.isFinite)) return null;
    return SIHANG_STAIR_ROUTES.find(route =>
      within(point.x, point.z, route.landing) && Math.abs(point.y - route.landing.height) < .025 ||
      route.flights.some(flight => within(point.x, point.z, flight) &&
        Math.abs(point.y - sihangStairHeight(flight, point.z)) < .025));
  }
  function stairProjection(point, route) {
    let best = null, progress = 0;
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = route.waypoints[i - 1], b = route.waypoints[i], dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const t = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length), 0, 1);
      const x = a.x + dx * t, z = a.z + dz * t;
      const y = i === 2 ? sihangStairHeight(route.flights[0], z)
        : i === 6 ? sihangStairHeight(route.flights[1], z) : a.y;
      if (Math.abs(y - point.y) > .025) { progress += length; continue; }
      const distance = Math.hypot(point.x - x, point.z - z);
      if (!best || distance < best.distance) best = { x, y, z, distance, progress: progress + length * t };
      progress += length;
    }
    return best;
  }
  function stairPath(from, to, route) {
    const entry = stairProjection(from, route), exit = stairProjection(to, route);
    if (!entry || !exit) return [];
    const path = [], prefix = physicalConnector(from, entry, true);
    if (!prefix.length && entry.distance > .001) return [];
    path.push(...prefix);
    let progress = 0;
    const middle = [];
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = route.waypoints[i - 1], b = route.waypoints[i];
      progress += Math.hypot(b.x - a.x, b.z - a.z);
      if (progress > Math.min(entry.progress, exit.progress) + .001 &&
        progress < Math.max(entry.progress, exit.progress) - .001) middle.push({ ...b, progress });
    }
    if (exit.progress < entry.progress) middle.reverse();
    let previous = entry;
    for (const next of [...middle, exit]) {
      const segment = physicalConnector(previous, next);
      if (!segment.length && Math.hypot(previous.x - next.x, previous.z - next.z) > .001) return [];
      path.push(...segment); previous = next;
    }
    const finish = physicalConnector(exit, to, true);
    if (!finish.length && exit.distance > .001) return [];
    path.push(...finish);
    return path.length ? path : [{ x: to.x, y: to.y, z: to.z }];
  }
  function elevatedPath(start, goal, preferredStair = null) {
    if (![start?.x, start?.z, start?.y ?? 0, goal?.x, goal?.z, goal?.y ?? 0].every(Number.isFinite))
      throw new RangeError('Sihang path requires finite endpoints');
    const startRamp = stairAt(start), goalRamp = stairAt(goal);
    if (startRamp && goalRamp === startRamp) return stairPath(start, goal, startRamp);
    if (startRamp) {
      const exit = (goal.y ?? 0) <= startRamp.bottom.y ? startRamp.bottom : startRamp.top;
      const remainder = elevatedPath(exit, goal, preferredStair);
      const prefix = stairPath(start, exit, startRamp);
      return remainder.length && prefix.length ? [...prefix, ...remainder] : [];
    }
    if (goalRamp) {
      const entry = (start.y ?? 0) <= goalRamp.bottom.y ? goalRamp.bottom : goalRamp.top;
      const approach = elevatedPath(start, entry, preferredStair);
      const finish = stairPath(entry, goal, goalRamp);
      return approach.length && finish.length ? [...approach, ...finish] : [];
    }
    const from = Math.round((start.y ?? groundHeight(start.x, start.z)) / W.floorHeight);
    const to = Math.round((goal.y ?? groundHeight(goal.x, goal.z)) / W.floorHeight);
    if (from < 0 || from > 3 || to < 0 || to > 3 || ruined && (from || to)) return [];
    if (from === to) return floorPath(start, goal, from);
    let best = null, bestCost = Infinity;
    for (const stair of SIHANG_STAIRWELLS) {
      if (preferredStair && stair.id !== preferredStair) continue;
      const path = [], direction = Math.sign(to - from);
      let cursor = start, valid = true;
      for (let level = from; level !== to; level += direction) {
        const route = SIHANG_STAIR_ROUTES.find(r => r.x === stair.x && r.floor === (direction > 0 ? level : level - 1));
        const entry = direction > 0 ? route.bottom : route.top;
        const exit = direction > 0 ? route.top : route.bottom;
        const approach = floorPath(cursor, entry, level);
        if (!approach.length) { valid = false; break; }
        const connection = stairPath(entry, exit, route);
        if (!connection.length) { valid = false; break; }
        path.push(...approach, ...connection);
        cursor = exit;
      }
      if (!valid) continue;
      const end = floorPath(cursor, goal, to);
      if (!end.length) continue;
      path.push(...end);
      let previous = start, cost = 0;
      for (const p of path) { cost += Math.hypot(p.x - previous.x, p.z - previous.z); previous = p; }
      if (cost < bestCost) { best = path; bestCost = cost; }
    }
    return best ?? (preferredStair ? elevatedPath(start, goal) : []);
  }
  function updateCivilians(dt, now) {
    for (const person of civilians) {
      const data = person.userData, target = data.route[data.waypoint];
      let dx = 0, dz = 0, moved = 0;
      if (!data.waiting && dt > 0) {
        dx = target.x - person.position.x; dz = target.z - person.position.z;
        const length = Math.hypot(dx, dz), distance = Math.min(length, dt * .72);
        const oldX = person.position.x, oldZ = person.position.z;
        if (length) moveInfantry(person.position, dx / length * distance, dz / length * distance, .27);
        moved = Math.hypot(person.position.x - oldX, person.position.z - oldZ);
        if (length < .15) data.waypoint = 1 - data.waypoint;
        doorSystem.openAhead(person.position, target);
      }
      advanceCivilianMotion(person, { dt, now, moved, dx, dz, mode: data.waiting ? 'waiting' : 'street' });
    }
  }
  const world = {
    solids, obstacles, smoke, flags, boxGeometry, groundHeight, walkHeight, moveInfantry, elevatedPath, stairAt,
    groundSurface: (x, z) => within(x, z, W) || sihangSouthBank({ x, z }) || x >= 44 && x <= 52 ? 'stone' : 'earth',
    armorObstacles: obstacles, town, outskirts: { buildings: [], hills: [] }, visibility: {}, doorSystem,
    sceneArt: { staticRendering, warehouseBreaches: breaches.filter(h => h.blown).length,
      shopAwnings: city.budget.awnings, city: city.budget, flag: { vertices: 425, triangles: 768 } }, staticRendering,
    staticDamage: { craters: [], ruinedShops: [], wrecks: [] },
    bridgeSurfaces: { deck: 1.15, northRamp: 0, southRamp: 0, heightAt: bridgeHeight },
    riverSurfaces: { water: -1, northBank: 0, southBank: 0, street: 0 },
    impactHeight: groundHeight, isDeepWater, riverBounds: sihangRiverBounds,
    updateFlag: flagAnimation.update,
    setNightLighting: city.setNightLighting,
    get concessionLighting() { return city.lighting; },
    landmarks: { warehouse, bridge: { ...B, deck: bridgeDeck, heightAt: bridgeHeight },
      bridges: [{ ...B, type: 'arched-stone-bridge' }], streets: town.streets, buildings: town.buildings,
      cityStreets: town.streets, residentialBuildings: town.buildings.slice(1), river: R, roofFlag },
    civilians, civilianVisuals: civilians, updateCivilians,
    objectives: [{ id: 'sihang-warehouse', name: '四行仓库', x: -4, y: 0, z: -25, ...SIHANG_CAPTURE_AREA }],
    get warehouseRuined() { return ruined; },
    ruinWarehouse() {
      if (ruined) return;
      ruined = true; intact.visible = false; rubble.visible = true;
      for (const mesh of standingSolids) { const i = solids.indexOf(mesh); if (i >= 0) solids.splice(i, 1); }
      for (const obstacle of standingObstacles) { const i = obstacles.indexOf(obstacle); if (i >= 0) obstacles.splice(i, 1); }
      navigators.clear(); movementLookup.rebuild();
    },
    resetCampaign() {
      if (ruined) {
        solids.push(...standingSolids); obstacles.push(...standingObstacles);
      }
      ruined = false; intact.visible = true; rubble.visible = false;
      marker.material.color.setHex(0x557ca5); smoke.length = 0; flagAnimation.update(0);
      smoke.push(...city.smoke);
      doorSystem.reset(); navigators.clear(); movementLookup.rebuild();
      for (const person of civilians) {
        const data = person.userData;
        person.position.set(data.startX, 0, data.startZ); person.rotation.set(0, 0, 0); person.visible = true;
        data.dead = false; data.health = 100; data.waypoint = 1; data.walkPhase = data.civilianId * .71;
        delete data.escapeMotion;
        advanceCivilianMotion(person, { dt: 0, now: 0, moved: 0, mode: data.waiting ? 'waiting' : 'street' });
      }
      scene.updateMatrixWorld(true);
    },
  };
  world.resetCampaign();
  return world;
}
