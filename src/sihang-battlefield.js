import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { circleBlocked, createNavigator } from './core.js';
import { createDoorWorld } from './door-world.js';
import { createCivilianCharacterFactory } from './civilian-character.js';
import { advanceCivilianMotion } from './civilian-motion.js';
import { staticGeometryBatches } from './static-scene-batches.js';
import { obstacleLookup } from './spatial.js';
import {
  SIHANG_WAREHOUSE as W, SIHANG_RIVER as R, SIHANG_BRIDGE as B,
  SIHANG_CAPTURE_AREA, SIHANG_STAIRWELLS, SIHANG_STAIR_ROUTES,
} from './sihang-layout.js';

const within = (x, z, rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
const bridgeHeight = z => 1.15 * Math.sin(Math.PI * THREE.MathUtils.clamp((z - R.northZ) / 24, 0, 1));
const levels = [0, 4.2, 8.4, 12.6];

export function makeSihangBattlefield(scene, surface) {
  const solids = [], obstacles = [], smoke = [], flags = [], civilians = [];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
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
    const mesh = new THREE.Mesh(boxGeometry, material);
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
  // Separate dry banks leave the river physically and visually open.
  box(0, -.2, -50, 216, .4, 116, materials.earth);
  box(0, -.2, 70, 216, .4, 76, materials.street);
  for (const z of [-55, -3, 43, 82]) {
    box(0, -.025, z, 216, .05, 8, materials.street);
    town.streets.push({ x: 0, z, width: 216, depth: 8 });
  }
  for (const x of [-60, 48, 85]) {
    box(x, -.02, -50, 10, .04, 116, materials.street);
    town.streets.push({ x, z: -50, width: 10, depth: 116 });
  }
  const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x354f48, roughness: .48, metalness: .12 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(216, 24, 18, 8), waterMaterial);
  water.rotation.x = -Math.PI / 2; water.position.set(0, R.waterY, 20);
  water.name = 'suzhou-river'; scene.add(water);
  const riverBlocks = [
    { minX: -108, maxX: B.x - B.width / 2, minZ: 8, maxZ: 32, minY: -10, height: 40, water: true },
    { minX: B.x + B.width / 2, maxX: 108, minZ: 8, maxZ: 32, minY: -10, height: 40, water: true },
  ];
  obstacles.push(...riverBlocks);
  for (const z of [8, 32]) {
    for (const [left, right] of [[-108, 44], [52, 108]]) {
      box((left + right) / 2, -1.05, z, right - left, 2.1, .7, materials.concrete, { block: true });
      box((left + right) / 2, 1.05, z + (z === 8 ? -.3 : .3),
        right - left, .1, .12, materials.iron, { block: true });
      for (let x = left + 1; x < right; x += 3)
        box(x, .52, z, .1, 1.04, .1, materials.iron, { block: true });
    }
  }
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
    const strips = [
      { minX: W.minX, maxX: W.maxX, minZ: W.minZ, maxZ: -36 },
      { minX: W.minX, maxX: W.maxX, minZ: -16, maxZ: W.maxZ },
      { minX: W.minX, maxX: -34.5, minZ: -36, maxZ: -16 },
      { minX: -29.5, maxX: 21.5, minZ: -36, maxZ: -16 },
      { minX: 26.5, maxX: W.maxX, minZ: -36, maxZ: -16 },
    ];
    for (const rect of strips) {
      slab(rect.minX, rect.maxX, rect.minZ, rect.maxZ, y);
      floorRects.push({ ...rect, height: y });
    }
  }
  for (const route of SIHANG_STAIR_ROUTES) {
    const base = route.bottom.y, stair = SIHANG_STAIRWELLS.find(item => item.x === route.x);
    for (let step = 0; step < 28; step++) {
      const height = (step + 1) * W.floorHeight / 28;
      box(stair.x, base + height - .1, -36 + (step + .5) * 20 / 28,
        stair.width, .2, 20 / 28 + .01, materials.concrete, { parent: intact });
    }
    // Both sides have real sloping stringers; the central five-metre tread width stays clear.
    for (const x of [stair.minX + .08, stair.maxX - .08]) {
      const beam = box(x, base + 2.1 - .25, -26, .12, .28, Math.hypot(20, 4.2),
        materials.iron, { parent: intact });
      beam.rotation.x = -Math.atan2(4.2, 20);
    }
  }
  const breaches = [];
  for (let floor = 0; floor < 3; floor++) {
    const base = floor * W.floorHeight;
    for (const z of [W.minZ, W.maxZ]) {
      for (let bay = 0; bay < 8; bay++) {
        const x = -32 + bay * 8;
        const blown = bay === 4 || floor === 0 && bay === 3;
        box(x - 4, base + 2.1, z, .7, 4.2, .8, materials.brick, { parent: intact, block: true });
        box(x, base + 3.95, z, 7.3, .5, .8, materials.concrete, { parent: intact, block: true });
        if (!blown)
          box(x, base + .55, z, 7.3, 1.1, .8, materials.brick, { parent: intact, block: true });
        if (!blown) {
          for (const offset of [-1.23, 1.23])
            box(x + offset, base + 2.4, z, .38, 2.6, .8, materials.brick, { parent: intact, block: true });
          for (const offset of [-2.46, 0, 2.46])
            box(x + offset, base + 2.45, z, 2.02, .08, .16, materials.iron, { parent: intact, block: true });
        } else {
          box(x - 3.35, base + .22, z, .55, .44, .9, materials.dark, { parent: intact, block: true });
        }
        breaches.push({ x, y: base + 1.8, z, width: blown ? 6 : 2, floor, blown });
      }
      box(W.maxX, base + 2.1, z, .7, 4.2, .8, materials.brick, { parent: intact, block: true });
    }
    for (const x of [W.minX, W.maxX]) {
      for (const z of [-38, -30, -22, -14]) {
        box(x, base + 2.1, z - 4, .8, 4.2, .65, materials.brick, { parent: intact, block: true });
        box(x, base + 3.95, z, .8, .5, 7.35, materials.concrete, { parent: intact, block: true });
        if (floor || z === -30 || z === -22) {
          box(x, base + .55, z, .8, 1.1, 7.35, materials.brick, { parent: intact, block: true });
          for (const offset of [-1.23, 1.23])
            box(x, base + 2.4, z + offset, .8, 2.6, .38, materials.brick, { parent: intact, block: true });
        }
      }
    }
    for (const x of [-12, 4]) for (const z of [-33, -17]) {
      box(x, base + 2.1, z, .65, 4.2, .65, materials.concrete, { parent: intact, block: true });
      box(x, base + 3.9, -25, .48, .6, 32, materials.concrete, { parent: intact, block: true });
    }
  }
  // Broken parapets leave roof firing positions, without sealing the stair exits.
  for (const z of [-42, -8]) for (let x = -32; x < 28; x += 8)
    if (x !== 0) box(x, 12.95, z, 4.5, .7, .55, materials.brick, { parent: intact, block: true });
  // Bounded debris sits outside doorways, squad origins and the demolition assembly space.
  for (let i = 0; i < 36; i++) {
    const x = -34 + (i % 12) * 5.3, z = i < 12 ? -44.5 : i < 24 ? -6 : -46;
    if (Math.abs(x) < 7 && z < -42) continue;
    const piece = box(x, .12, z, .4 + i % 3 * .15, .24, .45, materials.dark);
    piece.rotation.y = i * 2.39;
  }
  const warehouse = { id: 'sihang-warehouse', ...W, floors: 3, accessible: true,
    historicalAdaptation: 'three-playable-storeys', breaches, stairwells: SIHANG_STAIRWELLS,
    stairRoutes: SIHANG_STAIR_ROUTES, intact, rubble, destructible: false };
  town.buildings.push(warehouse);

  function house(id, x, z, w, d, south) {
    const building = { id, x, z, width: w, depth: d, floors: 2, accessible: true,
      exit: { x, z: z - d / 2 - 1 }, use: south ? 'shop' : 'residence', style: 'shanghai-masonry-1937' };
    town.buildings.push(building);
    const north = z - d / 2, back = z + d / 2, left = x - w / 2, right = x + w / 2;
    box(x, -.08, z, w, .16, d, materials.concrete);
    for (const side of [-1, 1])
      box(x + side * w / 2, 3.1, z, .45, 6.2, d, materials.brick, { block: true });
    box(x, 3.1, back, w, 6.2, .45, materials.brick, { block: true });
    for (const side of [-1, 1])
      box(x + side * (w / 4 + .7), 1.4, north, w / 2 - 1.4, 2.8, .45,
        materials.plaster, { block: true });
    box(x, 2.95, north, w, .3, .45, materials.concrete, { block: true });
    for (let offset = -w / 2; offset <= w / 2; offset += w / 4)
      box(x + offset, 4.7, north, .35, 3, .45, materials.brick, { block: true });
    box(x, 3.5, north, w, .8, .45, materials.plaster, { block: true });
    box(x, 6.3, z, w + .6, .35, d + .6, materials.dark, { block: true });
    box(x, 2.85, north - .7, w * .85, .12, 1.4, materials.wood);
    box(left + .8, .35, north + 1, .8, .7, 1, materials.wood, { block: true });
    box(right - .8, .35, back - 1, .8, .7, 1, materials.wood, { block: true });
    town.passages.push({ id: `${id}-front-door`, x, z: north, width: 2.8, height: 2.8, axis: 'x', openAngle: Math.PI / 2 });
    return building;
  }
  // Building lots never pinch the three broad northern armour approaches.
  for (const [i, x] of [-94, -40, 35, 96].entries()) house(`north-home-${i}`, x, -72, 12, 10, false);
  for (const [i, x] of [-90, -66, -42, -18, 12, 76, 98].entries())
    house(`concession-shop-${i}`, x, 64, 15, 13, true);
  for (const [i, x] of [-90, -60, -26, 8, 76, 100].entries())
    house(`concession-home-${i}`, x, 96, 13, 12, true);

  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x557ca5, roughness: .8 });
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, .08, 16), markerMaterial);
  marker.position.set(-4, .05, -25); intact.add(marker); flags.push(marker);
  const roofFlag = new THREE.Group(); roofFlag.name = 'sihang-roof-roc-flag';
  roofFlag.position.set(-4, 12.6, -12); intact.add(roofFlag);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.055, .065, 5, 8), materials.iron);
  pole.position.y = 2.5; roofFlag.add(pole);
  const blue = new THREE.MeshBasicMaterial({ color: 0x143581, side: THREE.DoubleSide });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.65, 10, 6), blue);
  cloth.position.set(1.25, 4, 0); roofFlag.add(cloth);
  const sunShape = new THREE.Shape();
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12, radius = i % 2 ? .3 : .56;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (!i) sunShape.moveTo(x, y); else sunShape.lineTo(x, y);
  }
  sunShape.closePath();
  const sun = new THREE.Mesh(new THREE.ShapeGeometry(sunShape), white);
  sun.position.set(1.25, 4, .015); roofFlag.add(sun);
  const gun = new THREE.Group(); gun.name = 'sihang-roof-aa-display';
  gun.position.set(5, 12.6, -12); intact.add(gun);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(boxGeometry, materials.iron);
    leg.position.set(side * .4, .45, 0); leg.scale.set(.12, 1.2, .12); leg.rotation.z = side * .45; gun.add(leg);
  }
  const receiver = new THREE.Mesh(boxGeometry, materials.iron);
  receiver.position.y = 1.25; receiver.scale.set(.3, .35, .8); gun.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.9, 8), materials.iron);
  barrel.position.set(0, 1.8, -.85); barrel.rotation.x = -.9; gun.add(barrel);
  warehouse.roofFlag = roofFlag; warehouse.antiAircraftGun = gun;

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
    // World-space baking keeps raycast solids identical to the visible damaged shell.
    for (const [material, cells] of staticGeometryBatches(objects, { spatial: true })) {
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
      route = [{ x, z: 35.5 }, { x: x + (i % 2 ? 1.5 : 0), z: 35.5 }];
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
    return z > R.northZ && z < R.southZ && (x < 44 || x > 52);
  }
  function groundHeight(x, z) {
    if (z >= 8 && z <= 32) return x >= 44 && x <= 52 ? bridgeHeight(z) : R.waterY;
    return 0;
  }
  function walkHeight(x, z, referenceY = groundHeight(x, z), step = .25) {
    let height = groundHeight(x, z);
    if (ruined || !within(x, z, W)) return height;
    for (const rect of floorRects)
      if (within(x, z, rect) && rect.height <= referenceY + step && rect.height > height) height = rect.height;
    for (const stair of SIHANG_STAIRWELLS) {
      if (!within(x, z, stair)) continue;
      const rise = (z + 36) / 20 * W.floorHeight;
      for (let floor = 0; floor < 3; floor++) {
        const candidate = floor * W.floorHeight + rise;
        if (candidate <= referenceY + step && candidate > height) height = candidate;
      }
    }
    return height;
  }
  function movementHeightAt(x, z, referenceY, radius, movementObstacles, bodyHeight) {
    if (![x, z, referenceY, radius].every(Number.isFinite) || radius < 0 || isDeepWater(x, z)) return null;
    const y = walkHeight(x, z, referenceY);
    const candidates = movementObstacles === obstacles && radius <= 3.5 ? movementLookup.at(x, z) : movementObstacles;
    if (y - referenceY > .26 || referenceY - y > .32 ||
      circleBlocked(x, z, radius, candidates.filter(o => !o.walkable || o.height > y + .25), y, bodyHeight)) return null;
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
    let navigator = navigators.get(level);
    if (!navigator) {
      const y = levels[level];
      const projected = doorSystem.navigationObstacles
        .filter(o => (!ruined || !standingObstacles.includes(o)) &&
          (o.minY ?? -Infinity) < y + 1.75 && (o.height ?? Infinity) > y + .025)
        .map(o => ({ ...o, minY: -10, height: 40 }));
      if (level && !ruined) {
        projected.push(
          { minX: -108, maxX: -35.55, minZ: -108, maxZ: 108 },
          { minX: 27.55, maxX: 108, minZ: -108, maxZ: 108 },
          { minX: -108, maxX: 108, minZ: -108, maxZ: -41.55 },
          { minX: -108, maxX: 108, minZ: -8.45, maxZ: 108 },
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
        return [...prefix, ...remainder.map(p => ({ ...p, y: level ? levels[level] : groundHeight(p.x, p.z) }))];
      }
    }
    return path.map(p => ({ ...p, y: level ? levels[level] : groundHeight(p.x, p.z) }));
  }
  doorSystem.onNavigationChanged = () => { navigators.clear(); movementLookup.rebuild(); };
  function rampAt(point) {
    if (ruined || point.z <= -36 || point.z >= -16) return null;
    return SIHANG_STAIR_ROUTES.find(route =>
      Math.abs(point.x - route.x) <= 2.5 &&
      Math.abs(point.y - (route.bottom.y + (point.z + 36) / 20 * 4.2)) < .26);
  }
  function rampPath(from, to, route) {
    const safeX = x => THREE.MathUtils.clamp(x, route.x - 1.9, route.x + 1.9);
    const entry = { ...from, x: safeX(from.x) }, exit = { ...to, x: safeX(to.x) };
    const path = [];
    if (entry.x !== from.x) {
      // Move sideways at the current height before descending away from a slab overlapped by the capsule.
      const recenter = physicalConnector(from, entry, true);
      if (!recenter.length) return [];
      path.push(...recenter);
    }
    const count = Math.max(1, Math.ceil(Math.hypot(exit.x - entry.x, exit.z - entry.z) / .5));
    let previous = entry;
    for (let i = 1; i <= count; i++) {
      const t = i / count, z = entry.z + (exit.z - entry.z) * t;
      const next = { x: entry.x + (exit.x - entry.x) * t, z,
        y: route.bottom.y + THREE.MathUtils.clamp((z + 36) / 20, 0, 1) * 4.2 };
      if (!physicalConnector(previous, next).length) return [];
      path.push(next); previous = next;
    }
    if (exit.x !== to.x) {
      const finish = physicalConnector(exit, to, true);
      if (!finish.length) return [];
      path.push(...finish);
    }
    return path;
  }
  function elevatedPath(start, goal) {
    const startRamp = rampAt(start), goalRamp = rampAt(goal);
    if (startRamp && goalRamp === startRamp) return rampPath(start, goal, startRamp);
    if (startRamp) {
      const exit = (goal.y ?? 0) <= startRamp.bottom.y ? startRamp.bottom : startRamp.top;
      const remainder = elevatedPath(exit, goal);
      const prefix = rampPath(start, exit, startRamp);
      return remainder.length && prefix.length ? [...prefix, ...remainder] : [];
    }
    if (goalRamp) {
      const entry = (start.y ?? 0) <= goalRamp.bottom.y ? goalRamp.bottom : goalRamp.top;
      const approach = elevatedPath(start, entry);
      const finish = rampPath(entry, goal, goalRamp);
      return approach.length && finish.length ? [...approach, ...finish] : [];
    }
    const from = Math.round((start.y ?? groundHeight(start.x, start.z)) / 4.2);
    const to = Math.round((goal.y ?? groundHeight(goal.x, goal.z)) / 4.2);
    if (from < 0 || from > 3 || to < 0 || to > 3 || ruined && (from || to)) return [];
    if (from === to) return floorPath(start, goal, from);
    let best = null, bestCost = Infinity;
    for (const stair of SIHANG_STAIRWELLS) {
      const path = [], direction = Math.sign(to - from);
      let cursor = start, valid = true;
      for (let level = from; level !== to; level += direction) {
        const route = SIHANG_STAIR_ROUTES.find(r => r.x === stair.x && r.floor === (direction > 0 ? level : level - 1));
        const entry = direction > 0 ? route.bottom : route.top;
        const exit = direction > 0 ? route.top : route.bottom;
        const approach = floorPath(cursor, entry, level);
        if (!approach.length) { valid = false; break; }
        path.push(...approach);
        // Preserve the actual ramp, including level landings, in both traversal directions.
        for (let i = 1; i <= 44; i++) {
          const z = entry.z + (exit.z - entry.z) * i / 44;
          path.push({ x: stair.x, z, y: route.bottom.y + THREE.MathUtils.clamp((z + 36) / 20, 0, 1) * 4.2 });
        }
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
    return best ?? [];
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
    solids, obstacles, smoke, flags, boxGeometry, groundHeight, walkHeight, moveInfantry, elevatedPath,
    groundSurface: (x, z) => within(x, z, W) || z > 32 || x >= 44 && x <= 52 ? 'stone' : 'earth',
    armorObstacles: obstacles, town, outskirts: { buildings: [], hills: [] }, visibility: {}, doorSystem,
    sceneArt: { staticRendering, warehouseBreaches: breaches.length, shopAwnings: 17 }, staticRendering,
    staticDamage: { craters: [], ruinedShops: [], wrecks: [] },
    bridgeSurfaces: { deck: 1.15, northRamp: 0, southRamp: 0, heightAt: bridgeHeight },
    riverSurfaces: { water: -1, northBank: 0, southBank: 0, street: 0 },
    impactHeight: groundHeight, isDeepWater,
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
      marker.material.color.setHex(0x557ca5); smoke.length = 0;
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
