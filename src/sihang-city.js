import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIHANG_RESERVED_LANES, SIHANG_WAREHOUSE, SIHANG_ENEMY_APPROACHES, sihangRiverBounds } from './sihang-layout.js';
import { createResidentialRoofGeometry } from './roof-geometry.js';

const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

export const SIHANG_SOUTH_BANK_LAMP_SPACING = 5;

export function sihangSouthBankStreetLampPositions() {
  const startX = -72, endX = 96, sampleStep = .25;
  const path = [];
  for (let x = startX; x < endX; x += sampleStep)
    path.push({ x, z: sihangRiverBounds(x).southZ + 4 });
  path.push({ x: endX, z: sihangRiverBounds(endX).southZ + 4 });
  const lamps = [path[0]];
  let distance = 0, nextLamp = SIHANG_SOUTH_BANK_LAMP_SPACING;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i], segment = Math.hypot(to.x - from.x, to.z - from.z);
    while (nextLamp <= distance + segment + 1e-9) {
      const progress = (nextLamp - distance) / segment;
      lamps.push({ x: from.x + (to.x - from.x) * progress,
        z: from.z + (to.z - from.z) * progress });
      nextLamp += SIHANG_SOUTH_BANK_LAMP_SPACING;
    }
    distance += segment;
  }
  return lamps;
}

export function createSihangCity({ scene, box: makeBox, town, materials, surface, addMesh }) {
  materials = { ...materials, brick: surface('brick', 0x989d91, .9),
    plaster: surface('plaster', 0xaaa18b, 1.2), wood: surface('timber', 0x594a35, 2) };
  const tiles = surface('tiles', 0x89918c, 1.4); tiles.side = THREE.DoubleSide;
  const budget = { northBuildings: 0, southBuildings: 0, usableGroundFloors: 0,
    awnings: 0, trees: 0, damagedTrunks: 0, reedClumps: 0, smokePlumes: 0,
    smokeSprites: 0, addedMaterials: 9, vegetationDrawCalls: 3, signDrawCalls: 1, sootDrawCalls: 1,
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
  const streetLampPositions = sihangSouthBankStreetLampPositions(), streetLights = [];
  const illuminatedLampIndices = [48, 72].map(targetX => streetLampPositions.reduce((best, point, index) =>
    Math.abs(point.x - targetX) < Math.abs(streetLampPositions[best].x - targetX) ? index : best, 0));
  for (const [index, { x, z }] of streetLampPositions.entries()) {
    box(x, 2.1, z, .14, 4.2, .14, materials.iron);
    box(x + .35, 4.2, z, .85, .12, .14, materials.iron);
    box(x + .7, 4.05, z, .38, .32, .38, warm);
    if (illuminatedLampIndices.includes(index)) {
      const light = new THREE.PointLight(0xffbf72, 0, 22, 2);
      light.position.set(x + .7, 3.8, z); scene.add(light); streetLights.push(light);
    }
  }
  const titles = ['春华旅馆', '江南饭店', '河畔茶室', '新声戏院', '永安客栈', '锦华舞厅', '民生商号'];
  const forms = [
    { name: 'low-brick-home', height: 3.25, southHeight: 4.3, roof: 'gable', rise: .95, columns: 2, brick: true },
    { name: 'plastered-shophouse', height: 5.4, southHeight: 6.4, roof: 'cross-gable', rise: 1.15, columns: 2 },
    { name: 'brick-workshop', height: 4.1, southHeight: 6.9, roof: 'paired-gables', rise: .8, columns: 3, brick: true },
    { name: 'tall-lane-house', height: 7.1, southHeight: 9, roof: 'gable', rise: 1.3, columns: 3 },
    { name: 'corniced-shop', height: 6.1, southHeight: 8.1, roof: 'parapet', rise: .55, columns: 4 },
  ];
  function house(id, x, z, w, d, south, serial) {
    const lot = { minX: x - w / 2 - 1, maxX: x + w / 2 + 1, minZ: z - d / 2 - 1, maxZ: z + d / 2 + 1 };
    if (overlaps(lot, SIHANG_WAREHOUSE.bounds)) return null;
    if (SIHANG_ENEMY_APPROACHES.some(origin => overlaps(lot, {
      minX: origin.x - 11, maxX: origin.x + 11, minZ: origin.z - 5, maxZ: origin.z + 5,
    }))) return null;
    if (SIHANG_RESERVED_LANES.some(lane => overlaps(lot, lane))) return null;
    if (town.buildings.some(building => building.bounds && overlaps(lot, building.bounds))) return null;
    const banks = [sihangRiverBounds(lot.minX), sihangRiverBounds(lot.maxX)];
    if (!south && lot.maxZ > Math.min(...banks.map(b => b.northZ)) - 1 ||
      south && lot.minZ < Math.max(...banks.map(b => b.southZ)) + 3) return null;
    const formIndex = Math.abs(Math.round(x * 3 + z * 5) + serial * 7) % forms.length;
    const form = forms[formIndex];
    const height = (south ? form.southHeight : form.height) + serial % 3 * .15;
    const facade = form.brick ? materials.brick : materials.plaster;
    const doorX = x;
    const leftWidth = doorX - 1.4 - (x - w / 2), rightWidth = x + w / 2 - doorX - 1.4;
    const damage = south ? 'intact' : ['wing-collapse', 'roof-loss', 'facade-breach', 'shell-damage'][
      Math.abs(Math.round(x + z) + serial) % 4];
    const openFront = damage === 'wing-collapse' || damage === 'facade-breach';
    const roofLost = damage === 'wing-collapse' || damage === 'roof-loss';
    const building = { id, x, z, width: w, depth: d, height, floors: 1,
      decorativeStoreys: Math.round(height / 2.7), accessible: true, playableFloors: [0], damaged: !south,
      bounds: lot, exit: { x: doorX, z: z - d / 2 - 1 },
      use: south ? ['hotel', 'restaurant', 'tea-house', 'theatre', 'inn', 'dance-hall', 'shop'][serial % 7] : 'residence',
      style: 'nanjing-residential-reused', layout: 'sihang-original',
      architecture: form.name, roofForm: form.roof, damagePattern: damage, doorX };
    town.buildings.push(building); budget.usableGroundFloors++;
    budget[south ? 'southBuildings' : 'northBuildings']++;
    const front = z - d / 2, back = z + d / 2;
    box(x, -.04, z, w, .08, d, materials.concrete);
    const collapsedHeight = 1.05 + serial % 3 * .2;
    for (const side of [-1, 1]) {
      const wallHeight = damage === 'wing-collapse' && side > 0 ? collapsedHeight : height;
      box(x + side * w / 2, wallHeight / 2, z, .45, wallHeight, d, facade, { block: true });
    }
    if (south || damage === 'facade-breach') box(x, height / 2, back, w, height, .45, facade, { block: true });
    else if (damage === 'shell-damage') {
      const holeX = x - w * .24, holeWidth = 1.5, bottom = 1.2, top = Math.min(3.2, height - .2);
      const left = holeX - holeWidth / 2 - (x - w / 2), right = x + w / 2 - holeX - holeWidth / 2;
      box(x - w / 2 + left / 2, height / 2, back, left, height, .45, facade, { block: true });
      box(x + w / 2 - right / 2, height / 2, back, right, height, .45, facade, { block: true });
      box(holeX, bottom / 2, back, holeWidth, bottom, .45, facade, { block: true });
      box(holeX, (height + top) / 2, back, holeWidth, height - top, .45, facade, { block: true });
      building.shellOpening = { x: holeX, y: (bottom + top) / 2, z: back, bottom, top, width: holeWidth };
    } else for (let strip = 0; strip < 4; strip++) {
      const remaining = strip < 2 ? height * (.7 + (serial + strip) % 4 * .07)
        : collapsedHeight + (serial + strip) % 2 * .12;
      box(x - w / 2 + (strip + .5) * w / 4, remaining / 2, back, w / 4, remaining, .45,
        strip === 1 ? materials.dark : facade, { block: true });
    }
    for (const side of [-1, 1]) if (!openFront || side < 0)
      box(side < 0 ? x - w / 2 + leftWidth / 2 : x + w / 2 - rightWidth / 2,
        1.4, front, side < 0 ? leftWidth : rightWidth, 2.8, .45, facade, { block: true });
    if (openFront) {
      // The doorway stays usable while the neighbouring facade has collapsed.
      box(doorX + 1.55, 1.4, front, .3, 2.8, .45, facade, { block: true });
      box((doorX + 1.7 + x + w / 2) / 2, collapsedHeight / 2, front, rightWidth - .3,
        collapsedHeight, .45, facade, { block: true });
      box(x - w / 2 + leftWidth / 2, (height + 2.8) / 2, front, leftWidth,
        height - 2.8, .45, facade, { block: true });
      box(doorX, 2.95, front, 2.8, .3, .45, materials.dark, { block: true });
      if (serial % 3 === 0 && height > 4) {
        const bottom = 3.6, top = Math.min(height - .3, 5.4), gapWidth = 2.1;
        building.damageOpening = { x: doorX, y: (bottom + top) / 2, z: front, width: gapWidth, bottom, top };
      }
    } else box(x, (height + 2.8) / 2, front, w, height - 2.8, .45,
      facade, { block: true });
    box(south ? x : doorX, 2.9, front - .05, south ? w + .2 : 3.3, .22, .65, materials.concrete);
    if (south) {
      if (form.roof === 'parapet')
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
      if (damage === 'wing-collapse') building.collapsedHeight = collapsedHeight;
      building.damageStyle = roofLost ? 'collapsed-wall-charred-rafters' : damage;
      for (let strip = 0; strip < (roofLost ? 3 : 0); strip++) {
        const width = w * (.35 + (strip + serial) % 3 * .035);
        box(x - w / 2 + width / 2, height - strip % 2 * .12, z - d / 2 + (strip + .5) * d / 3,
          width, .22, d / 3, materials.dark, { block: true });
      }
      for (let beam = 0; beam < (roofLost ? 2 + serial % 2 : 0); beam++) {
        const length = w * (.56 + beam % 2 * .08);
        const rafter = box(x - w / 2 + length / 2, height - .3 - beam % 3 * .16,
          z - d * .35 + beam * d * .23, length, .14, .16, materials.wood);
        rafter.rotation.z = -.04 - beam % 3 * .07;
      }
      for (let chunk = 0; chunk < 8; chunk++) {
        const piece = box(x + 1.9 + chunk % 2 * Math.max(.25, (w / 2 - 2.5) * .5),
          .18 + chunk % 2 * .12, front + .85 + Math.floor(chunk / 2) * d * .15,
          .45 + chunk % 2 * .2, .35, .45, chunk % 3 ? materials.brick : materials.dark);
        piece.rotation.y = chunk * 1.7;
      }
    }
    if (form.roof === 'parapet') {
      const span = south ? w : leftWidth;
      const center = south ? x : x - w / 2 + span / 2;
      box(center, height + .38, front, span, .65, .25, facade);
      box(center, height + .73, front, span + .15, .12, .4, materials.concrete);
    }
    const roofs = form.roof === 'parapet' ? 0 : form.roof === 'paired-gables' ? 2 : 1;
    for (let section = 0; section < roofs; section++) {
      const cross = form.roof === 'cross-gable';
      const width = w / roofs, roofX = x + (section - (roofs - 1) / 2) * width;
      const rise = Math.max(form.rise, (cross ? d : width) * .2);
      const roof = new THREE.Mesh(createResidentialRoofGeometry(
        (cross ? d : width) + .6, (cross ? width : d) + .8, rise,
        tiles.userData.metersPerTile ?? 1.4, roofLost, serial + section),
      form.roof === 'parapet' ? materials.dark : tiles);
      roof.name = `${id}-nanjing-tile-roof`;
      roof.position.set(roofX, height + (south ? .3 : .12), z);
      roof.rotation.y = cross ? Math.PI / 2 : 0;
      roof.castShadow = roof.receiveShadow = true; roof.userData.keepUV = true;
      scene.add(roof); addMesh(roof);
      // Supported end gables use the same roof profile as the Nanjing residences.
      if (form.roof !== 'parapet' && !cross) {
        const span = roofLost ? width * .45 : width, center = roofLost ? roofX - width * .275 : roofX;
        const shape = new THREE.Shape();
        shape.moveTo(-span / 2, 0); shape.lineTo(roofLost ? -span / 2 : 0, rise);
        shape.lineTo(span / 2, 0); shape.closePath();
        const gable = new THREE.Mesh(new THREE.ShapeGeometry(shape), facade);
        gable.position.set(center, height + (south ? .3 : .12), front - .03);
        gable.rotation.y = Math.PI;
        scene.add(gable); addMesh(gable);
      }
    }
    for (const side of [-1, 1]) {
      box(doorX + side * 1.46, 1.4, front - .09, .12, 2.8, .16, materials.wood);
      box(x + side * (w / 2 - .1), .18, z, .3, .36, d, materials.brick);
    }
    box(doorX, 2.85, front - .09, 3.04, .16, .16, materials.wood);
    const windowWidth = Math.min(1.3, w / (form.columns * 1.8));
    for (let y = 4.25; y < height - .65; y += 2.7) for (let column = 0; column < form.columns; column++) {
      const wx = x + ((column + .5) / form.columns - .5) * w * .78;
      if (openFront && wx + windowWidth / 2 > doorX - 1.4) continue;
      if (!south && (column + serial) % 3 === 0) continue;
      box(wx, y, front - .24, windowWidth, 1.4, .08, south ? warm : materials.wood);
      for (const edge of [-1, 1])
        box(wx + edge * windowWidth / 2, y, front - .31, .08, 1.52, .14, materials.wood);
      box(wx, y, front - .34, .055, 1.4, .08, materials.wood);
      box(wx, y - .75, front - .3, windowWidth + .25, .12, .3, materials.concrete);
      if (south && serial % 3 === 0) {
        box(wx, y - .8, front - .65, w / 7 + .4, .12, 1, materials.concrete);
        box(wx, y - .3, front - 1.05, w / 7 + .4, .08, .08, materials.iron);
      }
    }
    for (const hingeDirection of [1, -1]) town.passages.push({
      id: `${id}-front-door-${hingeDirection === 1 ? 'left' : 'right'}`,
      groupId: `${id}-front-door`, x: doorX - hingeDirection * .7, z: front, width: 1.4,
      height: 2.8, leafHeight: 2.65, thickness: .11, hingeDirection,
      axis: 'x', openAngle: -hingeDirection * Math.PI / 2,
    });
    return building;
  }
  let index = 0;
  house('warehouse-east-annex', 43, -55, 12, 14, false, 0);
  for (const [i, [x, z, w, d]] of [
    [-47, -39, 12, 10], [-47, -25, 12, 10], [-47, -11, 12, 10],
    [-59, -37, 7, 10], [-59, -23, 7, 10], [-59, -9, 7, 10],
    [48, -16.5, 12, 6], [48, -7.5, 12, 5], [59, -16.5, 6, 5],
    [-48, -54, 9, 6], [-35, -54, 9, 6], [-22, -54, 9, 6], [20, -54, 9, 6],
  ].entries()) house(`warehouse-neighbor-${i}`, x, z, w, d, false, index++);
  for (const z of [-54, -64, -82]) for (const x of [-7.5, 7.5])
    house(`warehouse-front-${x < 0 ? 'west' : 'east'}-${-z}`, x, z, 6, 6, false, index++);
  for (const z of [-99, -80, -64]) for (const x of [-98, -84, -54, -40, -24, 20, 36, 54, 84, 98])
    house(`north-block-${index}`, x + index % 3 - 1, z + index % 2 * 2,
      9.5 + index % 3, 8 + index % 3, false, index++);
  // Side streets continue beside (never across) the reserved armour flanks.
  for (const z of [-42, -8]) for (const x of [-98, -84, 84, 98])
    house(`north-block-${index}`, x, z, 11, 10, false, index++);
  for (const [i, x] of [-98, -82, -55, -42, 43, 57].entries())
    house(`north-infill-${i}`, x, -48, 10 + i % 2, 8, false, index++);
  for (const [i, x] of [-56, -42, -26, -10, 7, 23, 43, 59].entries())
    house(`north-quay-${i}`, x, sihangRiverBounds(x).northZ - 5.5, 8, 4, false, index++);
  const shops = [-90, -66, -42, -18, 12, 38, 98];
  for (const [i, x] of shops.entries()) house(`concession-shop-${i}`, x, 64, 15, 13, true, i);
  for (const [i, x, w, d] of [
    [0, -98, 12, 10], [1, -78, 5, 6], [2, -54, 5, 6], [3, -30, 12, 10],
    [4, 0, 12, 10], [5, 24, 12, 10], [6, 48, 12, 10], [7, 64, 12, 10], [8, 100, 12, 10],
  ])
    house(`concession-riverside-${i}`, x,
      Math.max(sihangRiverBounds(x - w / 2).southZ, sihangRiverBounds(x + w / 2).southZ) + 13,
      w, d, true, i + 19);

  for (const [index, [x, z]] of [[-62, -49], [-42, -45], [-57, -3], [43, -15], [59, -45]].entries()) {
    const bounds = { minX: x - 1.5, maxX: x + 1.5, minZ: z - .25, maxZ: z + .25 };
    if (town.buildings.some(building => overlaps(bounds, building.bounds)) ||
      SIHANG_RESERVED_LANES.some(lane => overlaps(bounds, lane))) continue;
    box(x, .625, z, 3, 1.25, .5, materials.brick, { block: true });
    box(x, 1.27, z, 3.2, .09, .58, materials.concrete);
    town.covers.push({ id: `warehouse-street-cover-${index}`, x, z: z + .8,
      height: 1.25, width: 3, coverZ: z });
    town.fortifications.push({ id: `warehouse-street-wall-${index}`, x, z, use: 'street-cover' });
  }

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
  const sootMaterial = new THREE.MeshBasicMaterial({ map: smokeTexture, color: 0x15120f,
    transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
  const sootParts = damaged.map(home => {
    const geometry = new THREE.PlaneGeometry(home.width * .42, home.height * .6);
    geometry.translate(home.x - home.width * .27, home.height * .34, home.z + home.depth / 2 + .24);
    return geometry;
  });
  const soot = new THREE.Mesh(mergeGeometries(sootParts), sootMaterial);
  soot.name = 'sihang-north-burned-facades'; scene.add(soot);
  for (const geometry of sootParts) geometry.dispose();
  budget.sootTriangles = damaged.length * 2;
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
    treePositions.push({ x, z: 52 });
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
  budget.totalTriangles = budget.staticTriangles + budget.vegetationTriangles + budget.signTriangles + budget.sootTriangles;
  let night = false, lightingLevel = 0;
  const dayWindow = warm.color.clone(), dayNeon = neonRed.color.clone();
  const nightWindow = new THREE.Color(0xdbc38b), nightRed = new THREE.Color(0x923c38), nightGreen = new THREE.Color(0x3a6450);
  const setNightLighting = enabled => {
    const level = typeof enabled === 'boolean' ? Number(enabled) : enabled;
    if (!Number.isFinite(level) || level < 0 || level > 1) throw new TypeError('Concession lighting requires a bounded night transition');
    if (lightingLevel === level) return;
    lightingLevel = level; night = level > 0;
    warm.color.copy(dayWindow).lerp(nightWindow, level); warm.emissiveIntensity = level * .7;
    neonRed.color.copy(dayNeon).lerp(nightRed, level); neonRed.emissiveIntensity = level * .55;
    neonGreen.color.copy(dayNeon).lerp(nightGreen, level); neonGreen.emissiveIntensity = level * .4;
    signMaterial.emissiveIntensity = level * .45;
    for (const light of streetLights) light.intensity = level * 35;
  };
  return { budget, smoke, titles, reservedLanes: SIHANG_RESERVED_LANES, setNightLighting,
    get lighting() { return { night, transition: lightingLevel, streetLamps: streetLampPositions.length,
      streetLampSpacing: SIHANG_SOUTH_BANK_LAMP_SPACING, streetLightSources: streetLights.length,
      streetLightIntensity: streetLights[0].intensity,
      windowIntensity: warm.emissiveIntensity,
      redIntensity: neonRed.emissiveIntensity, greenIntensity: neonGreen.emissiveIntensity,
      signIntensity: signMaterial.emissiveIntensity, windowColor: warm.color.getHex() }; } };
}
