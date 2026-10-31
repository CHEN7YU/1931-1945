import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTownLayout } from './town-layout.js';
import { BRIDGE as DEFAULT_BRIDGE, RIVER, bridgeGroundHeight, riverBedHeight, configureWalkSupport } from './ground.js';
import { createWalkSupport } from './multistory.js';
import { OBJECTIVES } from './core.js';
import { dryRiverGeometry, dryRiverDetails, crackedSiltTexture, siltPatchGeometry } from './dry-river.js';
import { WOODLAND_SPECIES, woodlandLayout, woodlandTreeGeometry, woodlandGroundContactGeometry, woodlandGroundContactMask } from './woodland.js';
import { createDoorWorld } from './door-world.js';
import { staticGeometryBatches, STATIC_BATCH_CELL_SIZE } from './static-scene-batches.js';
import { SHELL_CRATERS, CRATER_EDGE, RUINED_SHOPS } from './war-damage-layout.js';
import { damagedSurfaceGeometry, craterGeometry, addStaticWrecks } from './war-damage.js';
import { makeOutskirtsLayout, outskirtsObstacles } from './outskirts-layout.js';
import { BATTLE_AREA } from './battle-boundary.js';
import { weatheredWallPiece } from './scene-art.js';
import { streetGrimePatches, grimePatchGeometry, sandbagGeometry, sandbagCollisionProxy } from './scene-details.js';
import { SHOP_ART_STYLES, shopAwningGeometry, shopAwningFrame, shopNoticeGeometry, shopPrintMaterial,
  shopContactMaterial, shopContactPatches } from './shop-art.js';

export const PAVED_AREAS = [[0, 30, 150, 12], [0, -51, 150, 11], [0, 43, 9, 82], [8, -52, 9, 61],
  [4, -4, 17, 12], [0, 52.5, 87, 4], [-16, 62, 7, 14],
  [-29.5, 62, 3.4, 24], [31.75, 52.5, 4, 43],
  [0, -8.1, 108, 3.4], [0, -25.5, 108, 4],
  [-36, 18, 16, 12], [27, 16.5, 14, 13], [-9.5, -34.5, 5, 11],
  [8, -16, 16, 13]];

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

export function makeWorld(scene, surface, options = {}) {
  const solids = [], obstacles = [], smoke = [], flags = [], staticMeshes = [];
  const town = options.town ?? makeTownLayout();
  const BRIDGE = options.bridge ?? DEFAULT_BRIDGE;
  const groundHeight = (x, z) => bridgeGroundHeight(x, z, BRIDGE);
  const walkSupport = options.town ? createWalkSupport(town.pieces, groundHeight) : configureWalkSupport(town.pieces);
  const walkHeight = walkSupport.heightAt;
  const outskirts = makeOutskirtsLayout();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  let seed = 1938;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const plain = (color, roughness = 1) => new THREE.MeshStandardMaterial({ color, roughness });
  const brick = surface('brick', 0xb3aaa0, 2.4);
  const plaster = [surface('plaster', 0xd9d1bb), surface('plaster', 0xb8b7a9), surface('plaster', 0xe2d8c3)];
  const roofMat = surface('tiles', 0xb7bec0, 2.5);
  roofMat.side = THREE.DoubleSide;
  const timber = surface('timber', 0x82705b, 2);
  const doorTimber = surface('door-timber', 0xd5c8b5);
  const weatheredPlaster = surface('weathered-plaster', 0xe3dbc9);
  const crateTimber = surface('crate-timber', 0xb5a28a);
  const crateTrim = surface('crate-timber', 0x96846b);
  const wallGrime = surface('wall-grime');
  const charred = surface('timber', 0x302e2a, 2);
  const stone = surface('paving', 0xa6a49b, 2.5);
  const earth = surface('earth', 0xb8a88c, 4);
  const paving = surface('paving', 0xb8b0a0, 3);
  const sand = surface('burlap', 0xc3b28e);
  sand.vertexColors = true;
  const sceneArt = { wallPieces: 0, doorLeaves: 0, sandbagMaterial: 'burlap',
    grimeDecals: 0, detailedCargo: 0, detailedSandbags: 0,
    shopAwnings: 0, shopNotices: 0, contactPatches: 0, shopSamples: Object.freeze(Object.keys(SHOP_ART_STYLES)) };
  const awningGeometry = shopAwningGeometry();
  const noticeGeometry = shopNoticeGeometry();
  const shopCloth = new Map(Object.entries(SHOP_ART_STYLES).map(([id, style]) => {
    const material = surface('burlap', style.cloth);
    material.side = THREE.DoubleSide; material.vertexColors = true;
    return [id, material];
  }));
  const contactDust = shopContactMaterial(wallGrime.map.image);
  const iron = new THREE.MeshStandardMaterial({ color: 0x4d514e, roughness: .76, metalness: .65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202925, roughness: .35, metalness: .3 });
  const canvasMat = plain(0x665d47);
  const fadedCanvas = plain(0x9c9784);

  function mesh(geometry, mat, x, y, z, solid = false, parent = scene) {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = true;
    parent.add(object);
    staticMeshes.push(object);
    if (solid) solids.push(object);
    return object;
  }
  function box(x, y, z, w, h, d, mat, solid = false, parent = scene) {
    const object = mesh(boxGeometry, mat, x, y, z, solid, parent);
    object.scale.set(w, h, d);
    return object;
  }
  const obstacle = (x, z, w, d, height) => obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height });
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  function cylinder(x, y, z, radius, height, mat, parent = scene) {
    const object = mesh(cylinderGeometry, mat, x, y, z, false, parent);
    object.scale.set(radius, height, radius);
    return object;
  }
  function beam(a, b, radius, mat, parent = scene) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const object = cylinder(...start.clone().add(end).multiplyScalar(.5).toArray(), radius, start.distanceTo(end), mat, parent);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    return object;
  }

  const drySurface = (x, z, w, d, material, offset) => {
    const minZ = z - d / 2, maxZ = z + d / 2;
    for (const [from, to] of [[minZ, Math.min(maxZ, RIVER.centerZ - RIVER.bankHalfWidth)],
      [Math.max(minZ, RIVER.centerZ + RIVER.bankHalfWidth), maxZ]]) {
      if (to > from) mesh(damagedSurfaceGeometry(x, (from + to) / 2, w, to - from), material, 0, offset, 0, true);
    }
  };
  drySurface(0, 0, 800, 800, earth, -.035);
  const sediment = surface('dry-silt');
  sediment.vertexColors = true;
  mesh(dryRiverGeometry(), sediment, 0, 0, 0, true);
  const riverDetails = dryRiverDetails();
  const pebbles = new THREE.MeshStandardMaterial({ color: 0x716753, roughness: 1, vertexColors: true, flatShading: true });
  const pebbleGeometry = new THREE.IcosahedronGeometry(1, 1);
  for (const pebble of riverDetails.stones) {
    const geometry = pebbleGeometry.clone(), colors = [];
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      const shade = .6 + pebble.shade * .6;
      colors.push(shade, shade * .97, shade * .91);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const object = mesh(geometry, pebbles, pebble.x, pebble.y + pebble.size * .18, pebble.z);
    object.scale.set(pebble.size * pebble.stretch, pebble.size * .34, pebble.size);
    object.rotation.set(pebble.shade * .3, pebble.angle, pebble.shade * .2);
  }
  const dryGrass = new THREE.MeshStandardMaterial({ color: 0x857754, roughness: 1, side: THREE.DoubleSide });
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-.018, 0, 0, .018, 0, 0, .09, 1, .07], 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2));
  blade.computeVertexNormals();
  for (const tuft of riverDetails.grass) for (let i = 0; i < 5; i++) {
    const object = mesh(blade, dryGrass, tuft.x + Math.sin(i * 2.4) * .06, tuft.y, tuft.z + Math.cos(i * 2.4) * .06);
    object.scale.set(1, tuft.height * (.6 + i * .12), 1);
    object.rotation.y = tuft.angle + i * 2.4;
  }
  const cracks = new THREE.MeshStandardMaterial({
    map: crackedSiltTexture(), roughness: 1, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const patch of riverDetails.silt) mesh(siltPatchGeometry(patch), cracks, 0, 0, 0);
  sceneArt.dryRiver = { stones: riverDetails.stones.length, grassTufts: riverDetails.grass.length,
    siltPatches: riverDetails.silt.length, material: sediment.userData.source };
  const pavedAreas = PAVED_AREAS;
  for (const [x, z, w, d] of pavedAreas.slice(0, -1)) {
    drySurface(x, z, w, d, paving, .0125);
  }
  const craterMat = earth.clone(); craterMat.vertexColors = true;
  for (const crater of SHELL_CRATERS) {
    const paved = pavedAreas.some(([x, z, w, d]) => Math.abs(crater.x - x) < w / 2 && Math.abs(crater.z - z) < d / 2);
    mesh(craterGeometry(crater, paved ? .0125 : -.035), craterMat, 0, 0, 0, true);
    if (paved) for (let i = 0; i < 17; i++) {
      const angle = i / 17 * Math.PI * 2 + random() * .15, radius = crater.radius * (1.03 + random() * .2);
      const x = crater.x + Math.cos(angle) * radius, z = crater.z + Math.sin(angle) * radius;
      const fragment = box(x, groundHeight(x, z) + .075, z, .17 + random() * .2, .1, .17 + random() * .2, stone);
      fragment.rotation.y = random() * Math.PI;
    }
  }
  for (const x of [-4.65, 4.65]) {
    for (let z = 4; z < 74; z += 2) {
      if (z > 22 && z < 38) continue;
      if (town.buildings.some(building => Math.abs(z - building.doorZ) < 1.8)) continue;
      box(x, .065, z, .32, .13, 1.94, stone);
    }
  }

  box(8, (BRIDGE.height - .05) / 2, -16, BRIDGE.maxX - BRIDGE.minX, BRIDGE.height + .05, BRIDGE.maxZ - BRIDGE.minZ, stone, true);
  for (const [startZ, descending] of [[BRIDGE.minZ - BRIDGE.rampLength, false], [BRIDGE.maxZ, true]]) {
    const geometry = new THREE.BoxGeometry(16, 1, BRIDGE.rampLength);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const t = (positions.getZ(i) + BRIDGE.rampLength / 2) / BRIDGE.rampLength;
      positions.setY(i, positions.getY(i) > 0 ? BRIDGE.height * (descending ? 1 - t : t) : -.05);
    }
    geometry.computeVertexNormals();
    mesh(geometry, stone, 8, 0, startZ + BRIDGE.rampLength / 2, true);
  }
  for (const x of [.3, 15.7]) {
    const lift = BRIDGE.height - DEFAULT_BRIDGE.height;
    box(x, .95 + lift, -16, .45, 1.4, 13, stone, true);
    box(x, 1.68 + lift, -16, .65, .15, 13.3, stone);
    obstacle(x, -16, .45, 13, 1.65 + lift);
    for (const z of [-22, -19, -16, -13, -10]) {
      box(x, 1.1 + lift, z, .65, 1.8, .65, stone);
      box(x, 2.04 + lift, z, .82, .12, .82, stone);
    }
  }

  const shopNames = ['同德糧行', '永安布莊', '濟民藥舖', '運河茶館', '瑞和商號', '魯南客棧'];
  const signs = new Map();
  const grimeCanvas = document.createElement('canvas');
  grimeCanvas.width = grimeCanvas.height = 512;
  const grimeContext = grimeCanvas.getContext('2d');
  const damp = grimeContext.createLinearGradient(0, 0, 0, 512);
  damp.addColorStop(0, 'rgba(48,39,26,.01)');
  damp.addColorStop(.65, 'rgba(48,39,26,.04)');
  damp.addColorStop(1, 'rgba(48,39,26,.48)');
  grimeContext.fillStyle = damp; grimeContext.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 75; i++) {
    const x = random() * 512, y = random() * 440, length = 20 + random() * 160;
    const streak = grimeContext.createLinearGradient(x, y, x, y + length);
    streak.addColorStop(0, `rgba(43,37,26,${.05 + random() * .17})`);
    streak.addColorStop(1, 'rgba(43,37,26,0)');
    grimeContext.fillStyle = streak;
    grimeContext.fillRect(x, y, 2 + random() * 10, length);
  }
  grimeContext.strokeStyle = 'rgba(37,33,26,.22)';
  grimeContext.lineWidth = 1;
  for (let i = 0; i < 15; i++) {
    let x = random() * 512, y = random() * 512;
    grimeContext.beginPath(); grimeContext.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (random() - .5) * 16; y += 3 + random() * 10;
      grimeContext.lineTo(x, y);
    }
    grimeContext.stroke();
  }
  const grimeMap = new THREE.CanvasTexture(grimeCanvas);
  grimeMap.colorSpace = THREE.SRGBColorSpace;
  const grime = new THREE.MeshStandardMaterial({ map: grimeMap, transparent: true, depthWrite: false, roughness: 1 });
  function sign(text, x, y, z, width, parent = scene, style = null) {
    if (!signs.has(text)) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#2d2b24'; ctx.fillRect(0, 0, 1024, 256);
      for (let i = 0; i < 10000; i++) {
        ctx.fillStyle = `rgba(172,155,113,${random() * .11})`;
        ctx.fillRect(random() * 1024, random() * 256, random() * 15 + 1, 1);
      }
      ctx.strokeStyle = '#9a8861'; ctx.lineWidth = 5; ctx.strokeRect(16, 16, 992, 224);
      ctx.fillStyle = '#c9b58b'; ctx.font = 'bold 150px KaiTi, STKaiti, SimSun, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 138);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      signs.set(text, new THREE.MeshStandardMaterial({ map, roughness: .92 }));
    }
    const key = style ? `${text}:shop-art` : text;
    if (style && !signs.has(key)) signs.set(key, shopPrintMaterial(style, text, crateTimber.map.image, weatheredPlaster.map.image));
    box(x, y, z - .04, width + .15, width / 4 + .15, .14, style ? crateTrim : timber, false, parent);
    mesh(new THREE.PlaneGeometry(width, width / 4), signs.get(key), x, y, z + .04, false, parent);
    if (style) for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const fixing = cylinder(x + dx * width * .46, y + dy * width * .092, z + .05, .012, .012, iron, parent);
      fixing.rotation.x = Math.PI / 2;
    }
  }

  const eaveTile = new THREE.CylinderGeometry(.095, .095, .8, 6, 1, true, 0, Math.PI);
  eaveTile.rotateZ(Math.PI / 2);
  function roof(x, y, z, w, d, rise) {
    const geometry = createRoofGeometry(w, d, rise, roofMat.userData.metersPerTile);
    const object = mesh(geometry, roofMat, x, y, z, true);
    object.userData.keepUV = true;
    box(x, y + rise + .06, z, .35, .23, d + .5, roofMat);
    for (const side of [-1, 1]) {
      box(x + side * w / 2, y + .13, z, .13, .21, d, charred);
      for (let p = -d / 2; p <= d / 2; p += .5) {
        beam([x + side * (w / 2 - .9), y + .06, z + p], [x + side * (w / 2 + .02), y + .14, z + p], .055, timber);
      }
      for (let p = -d / 2; p <= d / 2; p += .28) {
        mesh(eaveTile, roofMat, x + side * (w / 2 - .3), y + .27, z + p);
      }
      const gable = new THREE.BufferGeometry();
      gable.setAttribute('position', new THREE.Float32BufferAttribute([-w/2 + .8,0,0, w/2 - .8,0,0, 0,rise - .05,0], 3));
      gable.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,w/3,0,w/6,rise/3], 2));
      gable.computeVertexNormals();
      if (side === -1) {
        gable.scale(-1, 1, 1);
        gable.computeVertexNormals();
      }
      mesh(gable, brick, x, y, z + side * (d / 2 - .8), true);
      beam([x - w / 2 + .7, y, z + side * (d / 2 - .7)], [x, y + rise, z + side * (d / 2 - .7)], .09, timber);
      beam([x, y + rise, z + side * (d / 2 - .7)], [x + w / 2 - .7, y, z + side * (d / 2 - .7)], .09, timber);
    }
  }

  function facade(x, z, width, depth, height, rotation, name, ruined) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    scene.add(group);
    const face = depth / 2 + .035;
    mesh(new THREE.PlaneGeometry(width, height), grime, 0, height / 2, face + .012, false, group);
    box(0, .31, face, width, .62, .12, brick, false, group);
    box(0, height - .3, face, width + .12, .15, .19, timber, false, group);
    const floors = Math.max(1, Math.floor(height / 3.2));
    for (let level = 0; level < floors; level++) {
      const y = 1.9 + level * 3.2;
      if (y + 1 > height) continue;
      for (let wx = -width / 2 + 2; wx < width / 2 - 1; wx += 3.2) {
        if (level === 0 && Math.abs(wx) < 1.6) continue;
        box(wx, y, face + .018, 1.25, 1.6, .09, dark, false, group);
        for (const side of [-1, 1]) {
          box(wx + side * .67, y, face + .08, .11, 1.78, .13, timber, false, group);
          box(wx, y + side * .83, face + .12, 1.45, .1, .17, timber, false, group);
          box(wx + side * .29, y, face + .12, .045, 1.6, .07, timber, false, group);
        }
        for (const offset of [-.38, .12, .58]) box(wx, y + offset, face + .13, 1.23, .045, .08, timber, false, group);
        box(wx, y - .94, face + .14, 1.61, .16, .4, stone, false, group);
        if (random() < .28 || ruined) {
          const board = box(wx, y + .08, face + .2, 1.65, .15, .12, ruined ? charred : timber, false, group);
          board.rotation.z = .15 + random() * .35;
        }
      }
    }
    if (floors > 1) box(0, 3.4, face + .07, width, .13, .17, timber, false, group);
    box(0, 1.4, face, 1.85, 2.8, .1, dark, false, group);
    for (let i = 0; i < 8; i++) box(-.77 + i * .22, 1.3, face + .08, .2, 2.5, .1, ruined ? charred : timber, false, group);
    for (const side of [-1, 1]) {
      box(side * 1.03, 1.5, face + .18, .17, 3, .22, timber, false, group);
      cylinder(side * .15, 1.3, face + .23, .035, .12, iron, group).rotation.x = Math.PI / 2;
    }
    box(0, .11, face + .3, 2.35, .22, .75, stone, false, group);
    if (name) {
      sign(name, 0, 3.2, face + .21, Math.min(4.8, width - 2), group);
      if (!ruined) {
        const awning = box(0, 2.8, face + .72, Math.min(5.4, width - 1), .08, 1.4, random() > .5 ? canvasMat : fadedCanvas, false, group);
        awning.rotation.x = .16;
        beam([-2.35, 2.15, face + .12], [-2.35, 2.7, face + 1.25], .035, timber, group);
        beam([2.35, 2.15, face + .12], [2.35, 2.7, face + 1.25], .035, timber, group);
      }
    }
    for (let i = 0; i < 5; i++) {
      const shape = new THREE.Shape();
      const rx = .3 + random() * .8, ry = .12 + random() * .3;
      for (let k = 0; k < 13; k++) {
        const a = k / 12 * Math.PI * 2, r = .7 + random() * .3;
        const px = Math.cos(a) * rx * r, py = Math.sin(a) * ry * r;
        if (k === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
      }
      shape.closePath();
      mesh(new THREE.ShapeGeometry(shape), brick, (random() - .5) * (width - 1), .48 + random() * .2, face + .018, false, group);
    }
  }

  let buildingIndex = 0;
  function building(x, z, w, d, height, ruined = false, { collider = true } = {}) {
    const mat = plaster[Math.floor(random() * plaster.length)];
    const wallHeight = ruined ? Math.min(3.8, height) : height;
    box(x, wallHeight / 2, z, w, wallHeight, d, mat, true);
    if (collider) obstacle(x, z, w, d, height + (ruined ? .5 : 3));
    box(x, .34, z, w + .14, .68, d + .14, brick, true);
    if (!ruined) roof(x, height, z, w + 1.6, d + 1.8, 2.6);
    else {
      for (const side of [-1, 1]) {
        for (let p = -d / 2; p < d / 2; p += 1.1) {
          const h = 1 + random() * (height - wallHeight);
          box(x + side * (w / 2 - .25), wallHeight + h / 2, z + p + .5, .5, h, 1.08, brick, true);
        }
        beam([x - w / 2, wallHeight + .2, z + side * (d / 2 - .4)], [x + w / 2, wallHeight + 1 + random(), z + side * (d / 2 - .4)], .12, charred);
      }
      for (let k = 0; k < 24; k++) {
        const block = box(x + (random() - .5) * (w + 1), .15 + random() * .25, z + d / 2 + random() * 2, .3 + random() * .8, .25 + random() * .5, .3 + random() * .8, k % 3 ? brick : roofMat, true);
        block.rotation.set(random() * .5, random() * Math.PI, random() * .3);
      }
    }
    const name = shopNames[buildingIndex++ % shopNames.length];
    facade(x, z, w, d, wallHeight, 0, name, ruined);
    facade(x, z, w, d, wallHeight, Math.PI, null, ruined);
    facade(x, z, d, w, wallHeight, Math.PI / 2, x < 0 ? name : null, ruined);
    facade(x, z, d, w, wallHeight, -Math.PI / 2, x > 0 ? name : null, ruined);
    box(x - w / 2 + 1.3, height + .8, z - d / 2 + 1.5, .85, 1.6, .85, brick);
    box(x - w / 2 + 1.3, height + 1.66, z - d / 2 + 1.5, 1.02, .12, 1.02, stone);
  }
  const townMaterials = { plaster: plaster[0], brick, timber, charred, stone, floor: timber };
  for (const piece of town.pieces) {
    let mat = piece.material === 'plaster' ? plaster[town.buildings.findIndex(item => piece.id.startsWith(`${item.id}-`)) % plaster.length] || plaster[0] : townMaterials[piece.material];
    if (weatheredWallPiece(piece, town.buildings)) {
      mat = weatheredPlaster;
      sceneArt.wallPieces++;
    }
    box(piece.x, piece.y, piece.z, piece.w, piece.h, piece.d, mat, true);
  }
  for (const patch of streetGrimePatches(town)) {
    const decal = mesh(grimePatchGeometry(patch), wallGrime, patch.x, patch.y, patch.z);
    decal.rotation.y = patch.normal * Math.PI / 2;
    decal.userData.keepUV = true;
    sceneArt.grimeDecals++;
  }
  obstacles.push(...town.obstacles);
  for (const shop of town.buildings) {
    if (!shop.ruined) roof(shop.x, shop.height, shop.z, shop.w + .8, shop.d + .8, shop.kind === 'home' ? 1.35 : 1.65);
    else {
      const partial = mesh(createRoofGeometry(shop.w + .8, (shop.d + .8) * .44, 1.65, roofMat.userData.metersPerTile),
        roofMat, shop.x, shop.height, shop.z - shop.d * .28, true);
      partial.userData.keepUV = true;
      for (const side of [-1, 1]) {
        const x = shop.x + side * 3.2, z = shop.z - 4.9;
        const post = beam([x, 0, z], [x, shop.height, z], .075, charred);
        solids.push(post); obstacle(x, z, .15, .15, shop.height);
        const rafter = beam([x, shop.height, z], [shop.x, shop.height + 1.65, z], .085, charred);
        solids.push(rafter);
      }
      for (const dz of [0, 2.4, 5.3]) {
        beam([shop.x - 3.8, shop.height, shop.z + dz], [shop.x, shop.height + 1.5, shop.z + dz], .1, charred);
        const broken = beam([shop.x, shop.height + 1.5, shop.z + dz], [shop.x + 3.5, 2.1 + (dz % 2) * .2, shop.z + dz + .5], .11, charred);
        solids.push(broken);
      }
      for (let i = 0; i < 24; i++) {
        const x = shop.x + (random() - .5) * 6.6, z = shop.z - 4.9 + random() * 1.4;
        const w = .3 + random() * .55, h = .15 + random() * .28, d = .3 + random() * .5;
        const rubble = box(x, h / 2, z, w, h, d, i % 3 ? brick : roofMat, true);
        rubble.rotation.y = random() * Math.PI;
        if (h > .33) obstacle(x, z, Math.abs(Math.cos(rubble.rotation.y)) * w + Math.abs(Math.sin(rubble.rotation.y)) * d,
          Math.abs(Math.sin(rubble.rotation.y)) * w + Math.abs(Math.cos(rubble.rotation.y)) * d, h);
      }
    }
    if (shop.kind === 'home') continue;
    const group = new THREE.Group();
    group.position.set(shop.x + shop.facing * shop.w / 2, 0, shop.doorZ);
    group.rotation.y = shop.facing * Math.PI / 2;
    scene.add(group);
    const style = SHOP_ART_STYLES[shop.id];
    sign(shop.name, 0, 2.98, .18, 2.85, group, style);
    if (style) {
      const notice = mesh(noticeGeometry,
        shopPrintMaterial(style, shop.name, crateTimber.map.image, weatheredPlaster.map.image, true),
        -1.85, 1.5, .13, false, group);
      notice.userData.keepUV = true;
      for (const x of [-.245, .245]) {
        const fixing = cylinder(-1.85 + x, 1.825, .143, .007, .01, iron, group);
        fixing.rotation.x = Math.PI / 2;
      }
      sceneArt.shopNotices++;
    }
    if (!shop.ruined && shop.kind === 'shop') {
      if (style) {
        mesh(awningGeometry, shopCloth.get(shop.id), 0, 0, .02, false, group).userData.keepUV = true;
        for (const part of shopAwningFrame()) {
          const support = beam(part.start, part.end, part.radius, timber, group);
          support.position.z += .02;
        }
        for (const side of [-1, 1]) {
          box(side * 1.4, 2.62, .15, .055, .1, .018, iron, false, group);
        }
        sceneArt.shopAwnings++;
      } else box(0, 2.6, .56, 2.8, .07, 1.12, fadedCanvas, false, group);
      if (!style) for (const side of [-1, 1]) beam([side * 1.22, 2.2, .05],
        [side * 1.22, 2.58, 1.05], .025, timber, group);
    }
  }
  for (const patch of shopContactPatches(town)) {
    const dust = mesh(new THREE.PlaneGeometry(patch.w, patch.d), contactDust, patch.x, .03, patch.z);
    dust.rotation.x = -Math.PI / 2; dust.userData.keepUV = true; dust.castShadow = false;
    sceneArt.contactPatches++;
  }
  const wrecks = addStaticWrecks(scene, { mesh, box, beam, obstacles, groundHeight, timber: charred });
  for (const z of [69, 44, 12, -38, -69]) {
    building(-61, z, 17, 15, 6 + random() * 3, random() < .3);
    building(65, z, 16, 14, 6 + random() * 3, random() < .25);
  }
  building(-7, -90, 24, 11, 8);
  building(-9, 92, 21, 10, 7);
  sign('臺 兒 莊', -7, 6.8, -84.3, 10);
  for (const house of outskirts.buildings) {
    const { x, z, w, d, height, ruined, near } = house;
    if (near) {
      building(x, z, w, d, height, ruined, { collider: false });
      continue;
    }
    const h = ruined ? height * .6 : height;
    const mat = plaster[Number(house.id.split('-').at(-1)) % plaster.length];
    for (const side of [-1, 1]) {
      box(x + side * (w / 2 - .2), h / 2, z, .4, h, d, mat, true);
      box(x, h / 2, z + side * (d / 2 - .2), w, h, .4, mat, true);
      for (const offset of [-w * .27, w * .27]) {
        box(x + offset, 1.7, z + side * (d / 2 + .015), 1.15, 1.4, .08, ruined ? charred : dark);
      }
    }
    box(x, .24, z, w + .1, .48, d + .1, brick, true);
    const roofDepth = ruined ? d * .42 : d + .8;
    mesh(createRoofGeometry(w + .8, roofDepth, 1.8, roofMat.userData.metersPerTile),
      roofMat, x, height, z - (ruined ? d * .27 : 0), true).userData.keepUV = true;
    if (ruined) {
      for (const dz of [0, d * .32]) {
        beam([x - w / 2, h, z + dz], [x, height + 1.8, z + dz], .1, charred);
        beam([x, height + 1.8, z + dz], [x + w * .4, h * .7, z + dz + .5], .1, charred);
      }
    } else box(x, height + 1.85, z, .3, .18, d + 1, roofMat);
  }
  // Match the visible plinth as well as the existing closed-building collider.
  obstacles.push(...outskirtsObstacles(outskirts));
  for (const [x, z, rotation] of [
    ...[-72, -48, 0, 24, 48, 72].flatMap(z => [
      [BATTLE_AREA.minX, z, Math.PI / 2], [BATTLE_AREA.maxX, z, -Math.PI / 2],
    ]),
    ...[-84, -60, -36, 12, 36, 60, 84].flatMap(x => [
      [x, BATTLE_AREA.minZ, 0], [x, BATTLE_AREA.maxZ, Math.PI],
    ]),
  ]) {
    const group = new THREE.Group();
    group.position.set(x, 0, z); group.rotation.y = rotation;
    scene.add(group);
    box(0, 1.1, 0, .15, 2.2, .15, charred, false, group);
    sign('戰區邊界', 0, 1.8, 0, 2.1, group);
  }

  const bagGeometry = new THREE.SphereGeometry(1, 10, 6);
  bagGeometry.setAttribute('color', new THREE.Float32BufferAttribute(
    new Float32Array(bagGeometry.attributes.position.count * 3).fill(1), 3));
  const detailedBagGeometry = sandbagGeometry();
  const bagUV = bagGeometry.attributes.uv;
  for (let i = 0; i < bagUV.count; i++) {
    bagUV.setXY(i, bagUV.getX(i) * 2 * Math.PI * .5 / .35, bagUV.getY(i) * Math.PI * .23 / .35);
  }
  function sandbags(x, z, count, rotate = false) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotate ? Math.PI / 2 : 0;
    scene.add(group);
    for (let row = 0; row < 3; row++) for (let i = 0; i < count; i++) {
      const detailed = x === -13 && z === 70;
      const bag = mesh(detailed ? detailedBagGeometry : bagGeometry, sand,
        (i - (count - 1) / 2) * 1.05 + (row % 2) * .3, .21 + row * .36, (random() - .5) * .1, !detailed, group);
      bag.userData.keepUV = true;
      bag.scale.set(.59, .23, .44);
      bag.rotation.y = (random() - .5) * .15;
      if (detailed) {
        // Keep the original invisible raycast surface as well as the unchanged movement collider.
        const collision = sandbagCollisionProxy(bag, bagGeometry);
        group.add(collision);
        solids.push(collision);
        sceneArt.detailedSandbags++;
      }
    }
    obstacle(x, z, rotate ? .8 : count * 1.05 + .5, rotate ? count * 1.05 + .5 : .8, 1.2);
  }
  sandbags(-12, 21, 5); sandbags(19, 29, 5, true);
  sandbags(-9, -43, 6); sandbags(18, -33, 4);
  sandbags(-13, 70, 4, true); sandbags(12, 2, 4, true);

  function crate(x, z, size = 1) {
    const detailed = x >= -15.1 && x <= -13.9 && z >= 58 && z <= 58.2;
    box(x, size * .45, z, size, size * .9, size * .8, detailed ? crateTimber : timber, true);
    for (const side of [-1, 1]) {
      box(x + side * size * .37, size * .45, z + size * .42, .08, size * .9, .09, detailed ? crateTrim : charred);
      box(x, size * .45 + side * size * .32, z + size * .42, size, .08, .09, detailed ? crateTrim : charred);
    }
    if (detailed) {
      for (const side of [-1, 1]) for (const height of [.13, .77]) {
        cylinder(x + side * size * .37, size * height, z + size * .42 + .05, .012, .012, iron).rotation.x = Math.PI / 2;
      }
      sceneArt.detailedCargo++;
    }
    obstacle(x, z, size, size * .8, size * .9);
  }
  function barrel(x, z) {
    const detailed = Math.abs(x + 13.8) < .01 && Math.abs(z - 59.2) < .01;
    const object = mesh(new THREE.CylinderGeometry(.33, .29, 1, 14, 2), detailed ? crateTimber : timber, x, .5, z, true);
    if (detailed) sceneArt.detailedCargo++;
    for (const y of [.16, .51, .85]) {
      const hoop = mesh(new THREE.TorusGeometry(.334, .024, 4, 14), iron, x, y, z);
      hoop.rotation.x = Math.PI / 2;
    }
    obstacle(x, z, .65, .65, 1);
    return object;
  }
  for (const [x, z] of [[-14, 58], [15, 47], [-14, 6], [15, -39], [-53, 40], [55, 66]]) {
    crate(x, z, .9); crate(x - 1, z + .1, .7); barrel(x + .2, z + 1.2);
    beam([x - 1.6, .05, z + .1], [x - 1.6, 2.6, z - .9], .055, timber);
  }
  // Small loose debris is visual dressing; large cover has matching collision.
  for (let i = 0; i < 560; i++) {
    const x = (random() - .5) * 170, z = (random() - .5) * 174;
    if (Math.abs(z + 16) < 7 || (Math.abs(x + 4) < 3 && random() < .7)) continue;
    const object = box(x, .04 + random() * .06, z, .12 + random() * .45, .06 + random() * .15, .1 + random() * .4, i % 4 ? brick : roofMat);
    object.rotation.set(random() * .5, random() * 6.28, random() * .3);
  }
  function cart(x, z, rotation) {
    const group = new THREE.Group();
    group.position.set(x, 0, z); group.rotation.y = rotation;
    scene.add(group);
    box(0, .8, 0, 1.25, .16, 1.8, timber, true, group);
    for (const side of [-1, 1]) {
      beam([side * .6, .83, .8], [side * .6, 1, -2.7], .05, timber, group);
      const wheel = mesh(new THREE.TorusGeometry(.6, .055, 5, 18), timber, side * .81, .61, .2, true, group);
      wheel.rotation.y = Math.PI / 2;
      cylinder(side * .8, .61, .2, .12, .25, iron, group).rotation.z = Math.PI / 2;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        beam([side * .8, .61, .2], [side * .8, .61 + Math.sin(a) * .58, .2 + Math.cos(a) * .58], .022, timber, group);
      }
      box(side * .63, 1.02, .2, .06, .4, 1.45, timber, false, group);
    }
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    obstacle((bounds.min.x + bounds.max.x) / 2, (bounds.min.z + bounds.max.z) / 2, bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1.2);
  }
  cart(16.5, 59, -.4);
  cart(-15, -32, 1.1);
  const scorchCanvas = document.createElement('canvas');
  scorchCanvas.width = scorchCanvas.height = 128;
  const scorchContext = scorchCanvas.getContext('2d');
  const scorchGradient = scorchContext.createRadialGradient(64, 64, 5, 64, 64, 62);
  scorchGradient.addColorStop(0, 'rgba(28,24,20,.64)');
  scorchGradient.addColorStop(.45, 'rgba(43,35,26,.48)');
  scorchGradient.addColorStop(1, 'rgba(43,35,26,0)');
  scorchContext.fillStyle = scorchGradient; scorchContext.fillRect(0, 0, 128, 128);
  const scorch = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(scorchCanvas), transparent: true, depthWrite: false, roughness: 1 });
  for (const [x, z] of [[-4, 61], [5, 39], [-8, 15], [8, -30], [-2, -55], [31, -36], [-2.7, 31], [10.6, -41]]) {
    const object = mesh(new THREE.PlaneGeometry(3 + random() * 3, 3 + random() * 3), scorch, x, .025, z);
    object.rotation.x = -Math.PI / 2;
    object.castShadow = false;
  }
  for (const z of [68, 40, 8, -36, -66]) {
    const poleX = z < -20 ? 11.8 : 3.9;
    const pole = cylinder(poleX, 5, z, .12, 10, timber);
    solids.push(pole); obstacle(poleX, z, .24, .24, 10);
    box(poleX, 8.9, z, 2.1, .15, .15, timber);
    for (const x of [poleX - .8, poleX + .8]) {
      cylinder(x, 9.14, z, .085, .22, stone);
      if (z !== -66) {
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 9.2, z), new THREE.Vector3(x, 7.5, z - 14), new THREE.Vector3(x, 9.2, z - 28));
        mesh(new THREE.TubeGeometry(curve, 12, .018, 3, false), iron, 0, 0, 0);
      }
    }
  }

  const species = Object.keys(WOODLAND_SPECIES);
  const bark = Object.fromEntries(species.map(kind => {
    const material = surface(`bark-${kind}`);
    material.vertexColors = true;
    return [kind, material];
  }));
  const leaves = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .92 });
  leaves.userData.spatialBatch = true;
  const treeContact = surface('root-litter', 0xd5c8b4);
  treeContact.alphaMap = woodlandGroundContactMask();
  treeContact.alphaMap.channel = 1;
  Object.assign(treeContact, { transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const trees = woodlandLayout(outskirts.buildings), treeMaterials = new Map();
  for (const tree of trees) {
    // Separate stands retain frustum culling after static material batching.
    const stand = `${tree.x < 0 ? 'west' : 'east'}-${tree.z < 0 ? 'north' : 'south'}`;
    if (!treeMaterials.has(stand)) treeMaterials.set(stand, { bark: new Map(), leaves: leaves.clone() });
    const materials = treeMaterials.get(stand);
    if (!materials.bark.has(tree.species)) materials.bark.set(tree.species, bark[tree.species].clone());
    const geometry = woodlandTreeGeometry(tree), y = groundHeight(tree.x, tree.z);
    mesh(geometry.bark, materials.bark.get(tree.species), tree.x, y, tree.z, true).userData.keepUV = true;
    if (geometry.foliage) mesh(geometry.foliage, materials.leaves, tree.x, y, tree.z);
    mesh(woodlandGroundContactGeometry(tree), treeContact, 0, 0, 0).castShadow = false;
    obstacle(tree.x, tree.z, tree.radius * 2, tree.radius * 2, tree.height * .8);
  }
  sceneArt.woodland = { trees: trees.length, stands: treeMaterials.size, leafStyle: 'individual-folded-leaves',
    leafBatches: 0, leafCellMeters: STATIC_BATCH_CELL_SIZE,
    barkBatches: [...treeMaterials.values()].reduce((sum, materials) => sum + materials.bark.size, 0),
    barkSources: Object.fromEntries(species.map(kind => [kind, bark[kind].userData.source])),
    groundContact: treeContact.userData.source,
    species: Object.fromEntries(['elm', 'poplar', 'willow'].map(species => [species, trees.filter(tree => tree.species === species).length])),
    saplings: trees.filter(tree => tree.age === 'sapling').length, deadTrees: trees.filter(tree => tree.dead).length,
    groundedTrees: trees.length,
    minHeight: Math.min(...trees.map(tree => tree.height)), maxHeight: Math.max(...trees.map(tree => tree.height)) };
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.width = smokeCanvas.height = 128;
  const ctx = smokeCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 1, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(45,42,36,.55)');
  gradient.addColorStop(.4, 'rgba(54,49,41,.32)');
  gradient.addColorStop(1, 'rgba(62,57,47,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const smokeMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(smokeCanvas), transparent: true, opacity: .55, depthWrite: false, color: 0xa7a49c });
  for (const [x, z] of [[-30, 11], [32, -38], [-60, -70]]) {
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Sprite(smokeMaterial);
      puff.userData = { originX: x, originZ: z, phase: i / 10 };
      scene.add(puff); smoke.push(puff);
    }
  }
  for (const point of options.objectives ?? OBJECTIVES) {
    const baseY = options.objectives ? groundHeight(point.x, point.z) : 0;
    cylinder(point.x, baseY + 3, point.z, .04, 6, timber);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xa19469, side: THREE.DoubleSide, roughness: 1 });
    const flagGeometry = new THREE.PlaneGeometry(1.8, 1, 10, 4);
    const flag = new THREE.Mesh(flagGeometry, flagMat);
    flag.position.set(point.x + .9, baseY + 5.3, point.z);
    flag.castShadow = true;
    scene.add(flag); flags.push(flag);
    const radius = options.objectives ? point.radius : 13;
    const ringGeometry = new THREE.RingGeometry(radius - .1, radius, 64);
    ringGeometry.rotateX(-Math.PI / 2);
    if (options.objectives) {
      const positions = ringGeometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        positions.setY(i, groundHeight(point.x + positions.getX(i), point.z + positions.getZ(i)));
      }
      ringGeometry.computeVertexNormals();
    }
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xc5b278, transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.set(point.x, .055, point.z); scene.add(ring);
  }
  // Pre-tinted haze keeps the distant ridges from tone-mapping into white silhouettes.
  const hillMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
  const hillBase = new THREE.Color(0x8e8d86), hillCrest = new THREE.Color(0x61746b), hillColor = new THREE.Color();
  for (const hill of outskirts.hills) {
    const geometry = new THREE.PlaneGeometry(hill.w, hill.d, 36, 24);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const colors = [];
    for (let i = 0; i < positions.count; i++) {
      const u = positions.getX(i) / hill.w + .5, v = positions.getZ(i) / hill.d + .5;
      const envelope = Math.pow(Math.max(0, Math.sin(u * Math.PI) * Math.sin(v * Math.PI)), 1.4);
      const ridge = .72 + .18 * Math.sin(u * Math.PI * 3 + hill.phase) + .1 * Math.cos(v * Math.PI * 4 + u * 5);
      const elevation = envelope * ridge;
      positions.setY(i, elevation * hill.height - .08);
      hillColor.copy(hillBase).lerp(hillCrest, Math.min(1, elevation * 1.4));
      colors.push(hillColor.r, hillColor.g, hillColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    mesh(geometry, hillMaterial, hill.x, 0, hill.z);
  }

  scene.updateMatrixWorld(true);
  for (const [mat, cells] of staticGeometryBatches(staticMeshes)) {
    for (const [cell, geometries] of cells) {
      const combined = new THREE.Mesh(mergeGeometries(geometries), mat);
      combined.userData.staticCell = cell;
      if (mat.userData.spatialBatch) sceneArt.woodland.leafBatches++;
      combined.geometry.computeBoundingBox();
      combined.geometry.computeBoundingSphere();
      combined.castShadow = !mat.transparent;
      combined.receiveShadow = true;
      scene.add(combined);
      geometries.forEach(geometry => geometry.dispose());
    }
  }
  const groundSurface = (x, z) => {
    if (riverBedHeight(x, z) < 0 && groundHeight(x, z) <= 0) return 'earth';
    if (SHELL_CRATERS.some(crater => Math.hypot(x - crater.x, z - crater.z) < crater.radius * CRATER_EDGE)) return 'earth';
    if (town.buildings.some(building => Math.abs(x - building.x) < building.w / 2 - .12 && Math.abs(z - building.z) < building.d / 2 - .12)) return 'wood';
    if (groundHeight(x, z) > 0) return 'stone';
    return pavedAreas.some(([cx, cz, w, d]) => Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= d / 2) ? 'stone' : 'earth';
  };
  const visibility = {};
  const probe = new THREE.Raycaster();
  for (const [name, z, y] of [['doorOpening', 64, 1.3], ['wall', 66, 1.3], ['window', 58.6, 1.3], ['sill', 58.6, .6], ['lintel', 64, 2.8]]) {
    probe.set(new THREE.Vector3(-2.5, y, z), new THREE.Vector3(-1, 0, 0));
    probe.far = 8;
    visibility[name] = probe.intersectObjects(solids, false).length === 0;
  }
  const bridgeSurfaces = {};
  for (const [name, z] of [['deck', -16], ['northRamp', -24.5], ['southRamp', -7.5]]) {
    probe.set(new THREE.Vector3(8, 2, z), new THREE.Vector3(0, -1, 0));
    probe.far = 4;
    bridgeSurfaces[name] = probe.intersectObjects(solids, false)[0]?.point.y;
  }
  const riverSurfaces = {};
  for (const [name, z] of [['bed', -16], ['southBank', -10], ['northBank', -22], ['street', -8]]) {
    probe.set(new THREE.Vector3(-48, 3, z), new THREE.Vector3(0, -1, 0));
    probe.far = 5;
    riverSurfaces[name] = probe.intersectObjects(solids, false)[0]?.point.y;
  }
  const doorSystem = createDoorWorld(scene, town, obstacles, solids, timber, iron, doorTimber);
  sceneArt.doorLeaves = doorSystem.doors.length;
  return { solids, obstacles, smoke, flags, boxGeometry, groundSurface, groundHeight, walkHeight,
    moveInfantry: walkSupport.move, bridgeSurfaces, riverSurfaces, town, outskirts, visibility, doorSystem, sceneArt,
    staticDamage: { craters: SHELL_CRATERS.map(crater => ({ ...crater })), ruinedShops: [...RUINED_SHOPS], wrecks } };
}
