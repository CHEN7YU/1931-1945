import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIHANG_RESERVED_LANES, sihangRiverBounds } from './sihang-layout.js';

const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

export function createSihangCity({ scene, box: makeBox, town, materials }) {
  const budget = { northBuildings: 0, southBuildings: 0, usableGroundFloors: 0,
    awnings: 0, trees: 0, damagedTrunks: 0, reedClumps: 0, smokePlumes: 0,
    smokeSprites: 0, addedMaterials: 8, vegetationDrawCalls: 3, signDrawCalls: 1,
    staticSources: 0, staticTriangles: 0, staticBatches: 0 };
  const materialRegions = new Set();
  function box(x, y, z, w, h, d, material, options = {}) {
    const mesh = makeBox(x, y, z, w, h, d, material, { ...options, feature: 'sihang-city' });
    budget.staticSources++;
    budget.staticTriangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    materialRegions.add(`${material.uuid}:${Math.floor(x / 64)},${Math.floor(z / 64)}`);
    return mesh;
  }
  const warm = new THREE.MeshStandardMaterial({ color: 0x31414c, emissive: 0xffb451, emissiveIntensity: 0, roughness: .55 });
  const red = new THREE.MeshStandardMaterial({ color: 0x923c38, roughness: .9 });
  const green = new THREE.MeshStandardMaterial({ color: 0x3a6450, roughness: .9 });
  const neonRed = new THREE.MeshStandardMaterial({ color: 0x393631, emissive: 0xbe352a, emissiveIntensity: 0 });
  const neonGreen = new THREE.MeshStandardMaterial({ color: 0x393631, emissive: 0x327953, emissiveIntensity: 0 });
  const signs = [], smoke = [], damaged = [];
  const titles = ['春华旅馆', '江南饭店', '河畔茶室', '新声戏院', '永安客栈', '锦华舞厅', '民生商号'];
  function house(id, x, z, w, d, south, serial) {
    const lot = { minX: x - w / 2 - 1, maxX: x + w / 2 + 1, minZ: z - d / 2 - 1, maxZ: z + d / 2 + 1 };
    if (SIHANG_RESERVED_LANES.some(lane => overlaps(lot, lane))) return null;
    const banks = [sihangRiverBounds(lot.minX), sihangRiverBounds(lot.maxX)];
    if (!south && lot.maxZ > Math.min(...banks.map(b => b.northZ)) - 1 ||
      south && lot.minZ < Math.max(...banks.map(b => b.southZ)) + 3) return null;
    const height = south ? 6.6 + serial % 3 * 1.6 : 5.8 + serial % 3 * 1.3;
    const building = { id, x, z, width: w, depth: d, height, floors: 1,
      decorativeStoreys: Math.ceil(height / 3.2), accessible: true, playableFloors: [0], damaged: !south,
      bounds: lot, exit: { x, z: z - d / 2 - 1 },
      use: south ? ['hotel', 'restaurant', 'tea-house', 'theatre', 'inn', 'dance-hall', 'shop'][serial % 7] : 'residence',
      style: 'shanghai-masonry-1937' };
    town.buildings.push(building); budget.usableGroundFloors++;
    budget[south ? 'southBuildings' : 'northBuildings']++;
    const front = z - d / 2, back = z + d / 2;
    box(x, -.04, z, w, .08, d, materials.concrete);
    for (const side of [-1, 1]) box(x + side * w / 2, height / 2, z, .45, height, d, materials.brick, { block: true });
    box(x, height / 2, back, w, height, .45, materials.brick, { block: true });
    for (const side of [-1, 1]) box(x + side * (w / 4 + .7), 1.4, front, w / 2 - 1.4, 2.8, .45,
      south ? materials.plaster : materials.brick, { block: true });
    if (!south && serial % 3 === 0) {
      const bottom = 3.6, top = Math.min(height - .3, 5.4), gapWidth = 2.1;
      building.damageOpening = { x, y: (bottom + top) / 2, z: front, width: gapWidth, bottom, top };
      for (const side of [-1, 1]) box(x + side * (w + gapWidth) / 4, (height + 2.8) / 2, front,
        (w - gapWidth) / 2, height - 2.8, .45, materials.brick, { block: true });
      box(x, (2.8 + bottom) / 2, front, gapWidth, bottom - 2.8, .45, materials.dark, { block: true });
      box(x, (height + top) / 2, front, gapWidth, height - top, .45, materials.brick, { block: true });
    } else box(x, (height + 2.8) / 2, front, w, height - 2.8, .45,
      south ? materials.plaster : materials.dark, { block: true });
    box(x, 2.9, front - .05, w + .2, .22, .65, materials.concrete);
    if (south) {
      box(x, height + .15, z, w + .6, .3, d + .6, materials.dark, { block: true });
      box(x, height - .5, front - .2, w + .4, .3, .6, materials.concrete);
      box(x, .07, front - 1.2, w + 1, .14, 2, materials.concrete);
      box(x, 2.85, front - .8, w * .85, .14, 1.6, serial % 2 ? red : green);
      box(x, 3.95, front - .29, w * .8, .075, .06, serial % 2 ? neonRed : neonGreen);
      budget.awnings++;
      for (const side of [-1, 1]) box(x + side * w * .3, 1.75, front - .25, w * .21, 1.5, .1, warm);
      const sign = new THREE.PlaneGeometry(w * .8, .85);
      sign.translate(x, 3.5, front - .26);
      const uv = sign.attributes.uv;
      const tile = serial % 7;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), (uv.getY(i) + tile) / 7);
      // North-facing shopfronts, visible from the river.
      sign.rotateY(0); signs.push(sign);
    } else {
      damaged.push(building);
      // Missing roof sections expose rafters, but most facade masonry still survives.
      box(x - w * .22, height, z, w * .5, .25, d, materials.dark, { block: true });
      box(x + w * .35, height - .6, z + d * .23, w * .25, .25, d * .45, materials.dark, { block: true });
      for (let beam = 0; beam < 4; beam++)
        box(x + (beam - 1.5) * w / 5, height - .5, z, .16, .18, d, materials.wood);
      for (let chunk = 0; chunk < 7; chunk++) {
        const piece = box(x + (chunk - 3) * w / 8, .18 + chunk % 2 * .12, front + .75,
          .6 + chunk % 2 * .3, .35, .55, materials.brick);
        piece.rotation.y = chunk * 1.7;
      }
    }
    for (let y = 4.6; y < height - .8; y += 2.6) for (let column = 0; column < 3; column++) {
      const wx = x + (column - 1) * w / 4;
      if (building.damageOpening && column === 1 && y < building.damageOpening.top) continue;
      if (!south && (column + serial) % 3 === 0) continue;
      box(wx, y, front - .24, w / 7, 1.4, .08, south ? warm : materials.wood);
      box(wx, y - .75, front - .3, w / 7 + .25, .12, .3, materials.concrete);
      if (south && serial % 3 === 0) {
        box(wx, y - .8, front - .65, w / 7 + .4, .12, 1, materials.concrete);
        box(wx, y - .3, front - 1.05, w / 7 + .4, .08, .08, materials.iron);
      }
    }
    town.passages.push({ id: `${id}-front-door`, x, z: front, width: 2.8, height: 2.8,
      axis: 'x', openAngle: Math.PI / 2 });
    return building;
  }
  let index = 0;
  for (const z of [-99, -77, -59]) for (const x of [-98, -84, -54, -40, -24, 20, 36, 54, 84, 98])
    house(`north-block-${index}`, x, z, 11, 10, false, index++);
  // Side streets continue beside (never across) the reserved armour flanks.
  for (const z of [-42, -8]) for (const x of [-98, -84, 84, 98])
    house(`north-block-${index}`, x, z, 11, 10, false, index++);
  const shops = [-90, -66, -42, -18, 12, 76, 98];
  for (const [i, x] of shops.entries()) house(`concession-shop-${i}`, x, 64, 15, 13, true, i);
  for (const [i, x] of [-96, -78, -60, -42, -24, -6, 12, 30, 48, 72, 90, 102].entries())
    house(`concession-home-${i}`, x, 96, 12, 12, true, i + 7);
  for (const [i, x] of [-98, -78, -54, -30, 0, 80, 100].entries())
    house(`concession-riverside-${i}`, x, 42, 12, 10, true, i + 19);

  // Original typographic atlas, shared by every sign. No dynamic lights or external assets.
  let signTexture;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 448;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 7; i++) {
      const y = (6 - i) * 64;
      ctx.fillStyle = i % 2 ? '#653428' : '#315747'; ctx.fillRect(0, y, 512, 64);
      ctx.strokeStyle = '#dbc298'; ctx.strokeRect(4, y + 4, 504, 56);
      ctx.fillStyle = '#f8e2ac'; ctx.font = 'bold 42px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(titles[i], 256, y + 32);
    }
    signTexture = new THREE.CanvasTexture(canvas);
  } else {
    signTexture = new THREE.DataTexture(new Uint8Array([235, 202, 133, 255]), 1, 1);
    signTexture.needsUpdate = true;
  }
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const signMaterial = new THREE.MeshStandardMaterial({ map: signTexture, side: THREE.DoubleSide,
    emissiveMap: signTexture, emissive: 0xffffff, emissiveIntensity: 0, roughness: .9 });
  const signGeometry = mergeGeometries(signs);
  scene.add(new THREE.Mesh(signGeometry, signMaterial));
  for (const geometry of signs) geometry.dispose();

  const smokeTexture = new THREE.DataTexture(new Uint8Array(Array.from({ length: 32 * 32 * 4 }, (_, i) => {
    if (i % 4 !== 3) return 255;
    const pixel = Math.floor(i / 4), x = pixel % 32 / 15.5 - 1, y = Math.floor(pixel / 32) / 15.5 - 1;
    return Math.max(0, 1 - Math.hypot(x, y)) ** 1.4 * 255;
  })), 32, 32);
  smokeTexture.needsUpdate = true;
  const smokeMaterial = new THREE.SpriteMaterial({ map: smokeTexture, color: 0x30302d, transparent: true, opacity: .65, depthWrite: false });
  for (const home of damaged.filter((_, i) => i % 6 === 0).slice(0, 6)) {
    budget.smokePlumes++;
    for (let layer = 0; layer < 5; layer++) {
      const phase = layer / 5, puff = new THREE.Sprite(smokeMaterial);
      puff.userData = { originX: home.x, originY: home.height, originZ: home.z, phase, homeId: home.id };
      puff.position.set(home.x + phase * 8, home.height + phase * 27, home.z);
      puff.scale.setScalar(5 + phase * 16); scene.add(puff); smoke.push(puff);
    }
  }
  budget.smokeSprites = smoke.length;

  // Three opaque instanced vegetation submissions avoid leaf-card alpha overdraw.
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x526748, roughness: 1 });
  const treePositions = [];
  for (const x of [-99, -75, -51, -27, 3, 78, 101]) {
    treePositions.push({ x, z: 52 }, { x: x + 2, z: 84 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.13, .25, 3.8, 6), materials.wood, treePositions.length + 5);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foliageMaterial, treePositions.length * 2);
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  for (const [i, p] of treePositions.entries()) {
    matrix.compose(new THREE.Vector3(p.x, 1.9, p.z), quaternion, new THREE.Vector3(1, 1, 1)); trunks.setMatrixAt(i, matrix);
    for (let crown = 0; crown < 2; crown++) {
      matrix.compose(new THREE.Vector3(p.x + crown * .7, 4 + crown * .65, p.z),
        quaternion, new THREE.Vector3(1.6, 1.45, 1.55)); crowns.setMatrixAt(i * 2 + crown, matrix);
    }
  }
  budget.trees = treePositions.length;
  for (const [i, x] of [-98, -84, -54, 20, 84].entries()) {
    matrix.compose(new THREE.Vector3(x, 1.2, -51), quaternion, new THREE.Vector3(.9, .6, .9));
    trunks.setMatrixAt(treePositions.length + i, matrix); budget.damagedTrunks++;
  }
  const reedGeometry = new THREE.ConeGeometry(.22, 1.4, 3), reedPositions = [];
  for (let x = -105; x < 107; x += 3) {
    if (x > 38 && x < 58) continue;
    const bounds = sihangRiverBounds(x);
    for (const z of [bounds.northZ + .8, bounds.southZ - .8]) reedPositions.push({ x, z });
  }
  const reeds = new THREE.InstancedMesh(reedGeometry, foliageMaterial, reedPositions.length);
  for (const [i, p] of reedPositions.entries()) {
    matrix.compose(new THREE.Vector3(p.x, -.6, p.z), quaternion, new THREE.Vector3(1, .7 + i % 3 * .15, 1));
    reeds.setMatrixAt(i, matrix);
  }
  budget.reedClumps = reedPositions.length;
  for (const mesh of [trunks, crowns, reeds]) {
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh);
  }
  budget.vegetationTriangles = trunks.count * 24 + crowns.count * 80 + reeds.count * 6;
  budget.signTriangles = signs.length * 2;
  budget.staticBatches = materialRegions.size;
  budget.totalTriangles = budget.staticTriangles + budget.vegetationTriangles + budget.signTriangles;
  let night = false;
  const setNightLighting = enabled => {
    if (typeof enabled !== 'boolean') throw new TypeError('Concession lighting requires an explicit night state');
    if (night === enabled) return;
    night = enabled;
    warm.color.setHex(night ? 0xdbc38b : 0x31414c); warm.emissiveIntensity = night ? .7 : 0;
    neonRed.color.setHex(night ? 0x923c38 : 0x393631); neonRed.emissiveIntensity = night ? .55 : 0;
    neonGreen.color.setHex(night ? 0x3a6450 : 0x393631); neonGreen.emissiveIntensity = night ? .4 : 0;
    signMaterial.emissiveIntensity = night ? .45 : 0;
  };
  return { budget, smoke, titles, reservedLanes: SIHANG_RESERVED_LANES, setNightLighting,
    get lighting() { return { night, windowIntensity: warm.emissiveIntensity,
      redIntensity: neonRed.emissiveIntensity, greenIntensity: neonGreen.emissiveIntensity,
      signIntensity: signMaterial.emissiveIntensity, windowColor: warm.color.getHex() }; } };
}
