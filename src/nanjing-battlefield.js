import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCivilianCharacterFactory } from './civilian-character.js';
import { resetCivilianStreetLife } from './civilian-street-life.js';
import { placeRefugeeRestGroups, resetCivilianFlight } from './civilian-refugees.js';
import { circleBlocked, createNavigator, setMapBounds } from './core.js';
import { createDoorWorld } from './door-world.js';
import { NANJING_CITY_WALLS, NANJING_DOCK, NANJING_DOCK_ENTRY_X, NANJING_DOCK_SHIFT, NANJING_FERRY_BERTHS, NANJING_PIER,
  nanjingPierHeight, NANJING_OBJECTIVES, NANJING_RIVER_SHORE_X, NANJING_SPAWNS, NANJING_WEST_BREACH, NANJING_MAP_BOUNDS, NANJING_DOCK_WEST_EXTENSION,
  NANJING_WEST_GATE_HALF_WIDTH, NANJING_WEST_GATE_Z } from './nanjing-campaign.js';
import { sandbagCollisionProxy, sandbagGeometry } from './scene-details.js';
import { createRoofGeometry, createResidentialRoofGeometry } from './roof-geometry.js';
import { AIR_SUPPORT, createAirSupport } from './air-support.js';
import { AIRCRAFT_GUN } from './aircraft-ai.js';
import { TYPES } from './core.js';
import { batchStaticScene } from './static-scene-batches.js';
import { NANJING_WALL_PLUMES, nanjingDamagedWallGeometry, nanjingWallNotch } from './nanjing-wall-damage.js';
import { createBuildingFire } from './building-fire.js';
import { createWaterWaveClock } from './water-waves.js';
import { selectBattlefieldCraters, addBattlefieldCraters } from './battlefield-craters.js';
import { addStaticWrecks } from './war-damage.js';
import { NANJING_EMPLACEMENTS, emplacementObstacles } from './emplacements.js';
import { NANJING_FERRY_ROUTE, restoreFerryPassenger, updateFerryVisibility } from './nanjing-ferry.js';
import { createNanjingDockDetails, createNanjingFerryFactory, createShoreReeds, NANJING_FERRY_FLOOR, updateNanjingFerryRower } from './nanjing-river-details.js';
import { obstacleLookup } from './spatial.js';
import { planeModel } from './world.js';
import { civilianWaitingSlot, NANJING_CIVILIAN_COUNT, nanjingOpeningCivilianStart,
  NANJING_OPENING_CIVILIAN_COUNT, NANJING_OPENING_BRIDGE_TARGET, NANJING_OPENING_SOURCES,
  nanjingOpeningCivilianReleaseAt, placeCivilianWaitingSlots } from './civilian-crowd.js';
import { cityStreetIntersectsLot, createNanjingCityLayout } from './nanjing-city-layout.js';
import { WOODLAND_SPECIES, woodlandTreeGeometry } from './woodland.js';
import { NANJING_CASEMATE, subtractCasemateBox, casemateGateSlices, casemateFloorAt,
  inNanjingCasemate, nearNanjingCasemate, casemateRoute } from './nanjing-casemate.js';
import { NANJING_COURTYARDS, NANJING_COURTYARD_HALF_WIDTH,
  NANJING_DETAIL_SCALE as DETAIL_SCALE, NANJING_FLANKING_BUFFERS, NANJING_GATE_HEIGHT,
  NANJING_GATE_LENGTH, NANJING_GATE_NORTH_EDGE, NANJING_GATE_SOUTH_EDGE, NANJING_GATE_POSITIONS, NANJING_GATE_TUNNEL, NANJING_GATE_WIDTH,
  NANJING_GATE_Z, NANJING_MAP_SCALE, NANJING_RAMPART_HEIGHT, NANJING_RAMPART_THICKNESS,
  NANJING_SOLDIER_CAVE, NANJING_SOLDIER_CAVES, NANJING_WALL_RAMPS,
  NANJING_WALL_STAIR, NANJING_WALL_WALK, NANJING_WALL_WALKS } from './nanjing-layout.js';

const GATE_WIDTH = NANJING_GATE_WIDTH;
const GATE_LENGTH = NANJING_GATE_LENGTH;
const STONE_WALLS = NANJING_GATE_POSITIONS;
const YUHUA_BRIDGE = Object.freeze({ x: -24, z: 52, width: 10 });
const SOUTH_RIVER_WATER = -1.9;
const WALL_WALK = NANJING_WALL_WALK;
const WALL_STAIR = NANJING_WALL_STAIR;
const RIVERS = Object.freeze([
  { id: 'qinhuai-south', name: '秦淮河南段', x: (NANJING_RIVER_SHORE_X + 105) / 2, z: 52, width: 105 - NANJING_RIVER_SHORE_X, depth: 26 },
  { id: 'yangtze-west', name: '长江', x: NANJING_RIVER_SHORE_X - 12, z: 0, width: 24, depth: 300 },
].map(Object.freeze));
const riverShoreDistance = (x, z) => {
  const [south, west] = RIVERS;
  let distance = 0;
  if (Math.abs(x - south.x) < south.width / 2 && Math.abs(z - south.z) < south.depth / 2)
    distance = Math.min(south.width / 2 - Math.abs(x - south.x), south.depth / 2 - Math.abs(z - south.z));
  const westBank = west.x + west.width / 2;
  if (x < westBank && x > westBank - NANJING_FERRY_ROUTE.riverWidth &&
    Math.abs(z - west.z) < NANJING_FERRY_ROUTE.riverDepth / 2)
    distance = Math.max(distance, westBank - x);
  return Math.max(0, distance);
};

export function makeNanjingBattlefield(scene, surface) {
  setMapBounds(NANJING_MAP_BOUNDS);
  const solids = [], obstacles = [], smoke = [], flags = [], ferries = [], civilians = [], civilianQueue = [];
  const flankWalkSupports = [];
  const residentialBuildings = [];
  const openingHouseCovers = new Map();
  const northernBackdrop = [];
  const residentialMeshes = [];
  let groundNavigation = null;
  let casemateObstaclesAt = null;
  let templeLandmark = null;
  const cityLayout = createNanjingCityLayout();
  const wallBreaches = [{ id: 'east-shell-breach', minX: 88, maxX: 94, minZ: 16, maxZ: 20.4 }];
  const impactGeometry = [];
  const terrainSurfaces = [], shellCraters = [];
  let craterSupport = () => 0;
  const town = { streetWidth: 9, buildings: [], pieces: [], covers: [], passages: [], obstacles: [] };
  const aaPlatformHeight = (x, z) => .36 * Math.max(0, Math.min(1,
    (1.8 - Math.abs(x + 68)) / .9, (1.8 - Math.abs(z + 71)) / .9));
  const breachHeight = (x, z) => .8 *
    Math.max(0, 1 - Math.abs(x + 72) / 5) *
    Math.max(0, 1 - Math.abs(z + 89) / 3);
  const groundHeight = (x, z) => {
    const platform = Math.max(aaPlatformHeight(x, z), nanjingPierHeight(x, z), breachHeight(x, z));
    return platform > 0 ? Math.max(craterSupport(x, z), platform) : craterSupport(x, z);
  };
  const impactHeight = (x, z) => {
    const south = RIVERS[0], west = RIVERS[1];
    if (x >= NANJING_PIER.minX && x <= NANJING_PIER.maxX &&
      z >= NANJING_PIER.minZ && z <= NANJING_PIER.maxZ) return groundHeight(x, z);
    if (Math.abs(x - south.x) < south.width / 2 && Math.abs(z - south.z) < south.depth / 2)
      return SOUTH_RIVER_WATER;
    if (x < west.x + west.width / 2 && x > west.x + west.width / 2 - NANJING_FERRY_ROUTE.riverWidth &&
      Math.abs(z - west.z) < NANJING_FERRY_ROUTE.riverDepth / 2) {
      const blend = Math.min(1, Math.max(0, Math.abs(z - south.z) - south.depth / 2) / 12);
      return -.28 + (SOUTH_RIVER_WATER + .28) * (1 - blend * blend * (3 - 2 * blend));
    }
    return groundHeight(x, z);
  };
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const ground = surface('earth', 0x777361, 4);
  const road = surface('paving', 0x77766a, 2.4);
  const brick = surface('brick', 0x989d91, .9);
  brick.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.2126, .7152, .0722))), diffuseColor.rgb, .12);');
  };
  brick.customProgramCacheKey = () => 'nanjing-grey-masonry';
  const warmBrick = brick.clone();
  warmBrick.color.set(0xa6a198);
  warmBrick.onBeforeCompile = brick.onBeforeCompile;
  warmBrick.customProgramCacheKey = brick.customProgramCacheKey;
  const stone = surface('paving', 0x96896f, 2.4);
  const courtyardGround = surface('earth', 0x62634e, 1.8);
  const timber = surface('timber', 0x594a35, 2);
  const water = new THREE.MeshStandardMaterial({ color: 0x514b3b, roughness: .38, metalness: .02, envMapIntensity: .9 });
  const waterWaves = createWaterWaveClock({ hazeColor: 0x858b7c, reflection: .72 });
  waterWaves.attach(water, 'z');
  water.normalMap.repeat.set(18, 8);
  water.normalScale.set(.34, .34);
  const burlap = surface('burlap', 0x9a8b67);
  burlap.vertexColors = true;
  const detailedSandbagGeometry = sandbagGeometry();
  const collisionSandbagGeometry = new THREE.SphereGeometry(1, 10, 6);
  const dark = new THREE.MeshStandardMaterial({ color: 0x242a28, roughness: .92 });
  const sceneArt = { wallPieces: 0, doorLeaves: 0, sandbagMaterial: 'burlap',
    grimeDecals: 0, detailedCargo: 0, detailedSandbags: 0, shopAwnings: 0,
    shopNotices: 0, contactPatches: 0, shopSamples: [],
    cityInfrastructure: { utilityPoles: 0, streetLamps: 0, overheadWireSpans: 0 } };

  function addBox(x, y, z, w, h, d, material, collision = false, wallPiece = false) {
    const geometry = boxGeometry.clone();
    const positions = geometry.attributes.position, normals = geometry.attributes.normal;
    const uv = geometry.attributes.uv, meters = material.userData.metersPerTile ?? 2.4;
    for (let index = 0; index < uv.count; index++) {
      uv.setXY(index, (Math.abs(normals.getX(index)) > .5 ? positions.getZ(index) * d : positions.getX(index) * w) / meters,
        (Math.abs(normals.getY(index)) > .5 ? positions.getZ(index) * d : positions.getY(index) * h) / meters);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    solids.push(mesh);
    if (collision) obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
      minY: y - h / 2, height: y + h / 2 });
    if (wallPiece) town.pieces.push({ x, y, z, w, h, d, material: 'stone', wall: true });
    return mesh;
  }
  function makeParapet(axis, min, max, fixed, base, { collision = true, damaged = null, height = 1 } = {}) {
    if (max <= min) return null;
    const thickness = .6, pitch = 2.4, openingWidth = .28;
    const openingBottom = .46, openingTop = .72, geometries = [], openings = [];
    const piece = (start, end, bottom, top) => {
      if (end <= start) return;
      const length = end - start, h = top - bottom, along = (start + end) / 2;
      const x = axis === 'x' ? along : fixed, z = axis === 'x' ? fixed : along;
      const w = axis === 'x' ? length : thickness, d = axis === 'x' ? thickness : length;
      const geometry = new THREE.BoxGeometry(w, h, d);
      const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
      const meters = brick.userData.metersPerTile ?? .9;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (Math.abs(normals.getX(i)) > .5 ? positions.getZ(i) + z : positions.getX(i) + x) / meters,
          (Math.abs(normals.getY(i)) > .5 ? positions.getZ(i) + z : positions.getY(i) + base + (bottom + top) / 2) / meters);
      }
      geometry.translate(x, base + (bottom + top) / 2, z);
      geometries.push(geometry);
      if (collision) obstacles.push({ minX: x - w / 2, maxX: x + w / 2,
        minZ: z - d / 2, maxZ: z + d / 2, minY: base + bottom, height: base + top });
    };
    const cells = Math.ceil((max - min) / pitch), cellLength = (max - min) / cells;
    for (let i = 0; i < cells; i++) {
      const start = min + i * cellLength, end = min + (i + 1) * cellLength, center = (start + end) / 2;
      if (damaged?.(center)) continue;
      piece(start, end, 0, openingBottom);
      piece(start, end, openingTop, height);
      if (cellLength > openingWidth + .4) {
        piece(start, center - openingWidth / 2, openingBottom, openingTop);
        piece(center + openingWidth / 2, end, openingBottom, openingTop);
        openings.push(center);
      } else {
        piece(start, end, openingBottom, openingTop);
      }
    }
    if (!geometries.length) return null;
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    const wall = new THREE.Mesh(geometry, brick);
    wall.castShadow = wall.receiveShadow = true;
    wall.userData.nanjingFeature = 'brick-parapet';
    wall.userData.parapet = { axis, min, max, fixed, base, height, thickness, openings, openingBottom, openingTop, openingWidth };
    scene.add(wall); solids.push(wall);
    return wall;
  }
  const cityPoleGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  const cityBeam = (start, end, radius, material, blocksShots = false) => {
    const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const mesh = new THREE.Mesh(cityPoleGeometry, material);
    mesh.position.copy(from.clone().add(to).multiplyScalar(.5));
    mesh.scale.set(radius, direction.length(), radius);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    if (blocksShots) solids.push(mesh);
    return mesh;
  };

  function makeSurface(x, z, w, d, material, y = -.16, clipRivers = true) {
    // Cut river openings out of terrain and roads, rather than burying water under a full ground plane.
    if (clipRivers && (material === ground || material === road && y < 0)) {
      let rectangles = [{ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }];
      for (const river of RIVERS) {
        rectangles = rectangles.flatMap(rect => {
          const minX = Math.max(rect.minX, river.id === 'yangtze-west'
            ? river.x + river.width / 2 - NANJING_FERRY_ROUTE.riverWidth : river.x - river.width / 2);
          const maxX = Math.min(rect.maxX, river.x + river.width / 2);
          const minZ = Math.max(rect.minZ, river.z - river.depth / 2);
          const maxZ = Math.min(rect.maxZ, river.z + river.depth / 2);
          if (minX >= maxX || minZ >= maxZ) return [rect];
          return [
            { ...rect, maxX: minX }, { ...rect, minX: maxX },
            { minX, maxX, minZ: rect.minZ, maxZ: minZ },
            { minX, maxX, minZ: maxZ, maxZ: rect.maxZ },
          ].filter(piece => piece.maxX > piece.minX && piece.maxZ > piece.minZ);
        });
      }
      for (const rect of rectangles) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set((rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2);
        mesh.receiveShadow = true;
        mesh.userData.nanjingFeature = 'dry-ground-surface';
        const uv = mesh.geometry.attributes.uv;
        const positions = mesh.geometry.attributes.position, meters = material.userData.metersPerTile ?? 3;
        for (let index = 0; index < uv.count; index++) {
          uv.setXY(index, (positions.getX(index) + mesh.position.x) / meters,
            (positions.getY(index) - mesh.position.z) / meters);
        }
        scene.add(mesh);
        terrainSurfaces.push(mesh);
      }
      return;
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    if (material !== water) {
      const uv = mesh.geometry.attributes.uv, positions = mesh.geometry.attributes.position;
      const meters = material.userData.metersPerTile ?? 3;
      for (let index = 0; index < uv.count; index++) {
        uv.setXY(index, (positions.getX(index) + x) / meters, (positions.getY(index) - z) / meters);
      }
    }
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (material !== water && y <= .02) terrainSurfaces.push(mesh);
    return mesh;
  }

  function shellPocks(x, y, z, radius, seed, face = -1) {
    const vertices = [], colors = [], sectors = 9;
    x += Math.sin(seed * 19.17) * .17;
    y += Math.cos(seed * 7.31) * .14;
    for (let index = 0; index < sectors; index++) {
      for (const [ring, corner] of [[0, index], [1, index], [1, index + 1],
        [1, index], [2, index], [2, index + 1], [1, index], [2, index + 1], [1, index + 1]]) {
        const angle = corner / sectors * Math.PI * 2;
        const r = ring === 0 ? 0 : radius * (ring === 1 ? .5 : 1) *
          (1 + .2 * Math.sin(corner * 3.7 + seed));
        vertices.push(x + Math.cos(angle) * r, y + Math.sin(angle) * r,
          z + face * .008);
        colors.push(.012, .009, .006, ring === 0 ? .95 : ring === 1 ? .8 : 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geometry.computeVertexNormals();
    impactGeometry.push(geometry);
  }

  function makeRiver(x, z, w, d, crossings = []) {
    const riverLevel = w > d ? SOUTH_RIVER_WATER : -.28;
    const other = RIVERS.find(river => river.x !== x || river.z !== z);
    const surfaces = w > d && other ? [
      makeSurface((other.x + other.width / 2 + x + w / 2) / 2, z,
        x + w / 2 - (other.x + other.width / 2), d, water, riverLevel),
    ] : [makeSurface(x + w / 2 - NANJING_FERRY_ROUTE.riverWidth / 2, z,
      NANJING_FERRY_ROUTE.riverWidth, NANJING_FERRY_ROUTE.riverDepth, water, riverLevel)];
    for (const riverSurface of surfaces) {
      riverSurface.userData.nanjingFeature = 'river-water';
      const oldGeometry = riverSurface.geometry;
      const { width, height } = oldGeometry.parameters;
      const extendedRiver = w < d && other;
      const outerWidthSegments = 32, nearWidthSegments = 100;
      const outerDepthSegments = 16, nearDepthSegments = 300;
      const nearWidth = Math.min(200, width), nearDepth = Math.min(300, height);
      const widthSegments = extendedRiver ? outerWidthSegments + nearWidthSegments : Math.ceil(width / 2);
      const heightSegments = extendedRiver ? outerDepthSegments * 2 + nearDepthSegments : Math.ceil(height / 2);
      riverSurface.geometry = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments);
      oldGeometry.dispose();
      if (extendedRiver) {
        const vertices = riverSurface.geometry.attributes.position;
        const uv = riverSurface.geometry.attributes.uv;
        for (let index = 0; index < vertices.count; index++) {
          const column = index % (widthSegments + 1), row = Math.floor(index / (widthSegments + 1));
          const localX = column <= outerWidthSegments
            ? -width / 2 + (width - nearWidth) * column / outerWidthSegments
            : width / 2 - nearWidth + nearWidth * (column - outerWidthSegments) / nearWidthSegments;
          const localY = row <= outerDepthSegments
            ? height / 2 - (height - nearDepth) / 2 * row / outerDepthSegments
            : row <= outerDepthSegments + nearDepthSegments
              ? nearDepth / 2 - nearDepth * (row - outerDepthSegments) / nearDepthSegments
              : -nearDepth / 2 - (height - nearDepth) / 2 *
                (row - outerDepthSegments - nearDepthSegments) / outerDepthSegments;
          vertices.setXY(index, localX, localY);
          uv.setXY(index, localX / width + .5, localY / height + .5);
          const worldZ = z - localY;
          const distance = Math.max(0, Math.abs(worldZ - other.z) - other.depth / 2);
          const blend = Math.min(1, distance / 12);
          const smooth = blend * blend * (3 - 2 * blend);
          vertices.setZ(index, (SOUTH_RIVER_WATER - riverLevel) * (1 - smooth));
        }
        riverSurface.geometry.computeVertexNormals();
      }
      const positions = riverSurface.geometry.attributes.position;
      const waterDepth = new Float32Array(positions.count);
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index) + riverSurface.position.x;
        const z = riverSurface.position.z - positions.getY(index);
        waterDepth[index] = riverShoreDistance(x, z);
      }
      riverSurface.geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(waterDepth, 1));
      riverSurface.geometry.computeBoundingSphere();
      riverSurface.geometry.boundingSphere.radius += .102;
    }
    const bank = 3, addBank = (minX, maxX, minZ, maxZ) => {
      // The two rivers meet here; neither embankment may divide the other waterway.
      const otherRiver = RIVERS.find(river => river.x !== x || river.z !== z);
      if (otherRiver && minX < otherRiver.x + otherRiver.width / 2 &&
        (w < d ? maxX >= otherRiver.x - otherRiver.width / 2 - 1e-6 : maxX > otherRiver.x - otherRiver.width / 2) &&
        minZ < otherRiver.z + otherRiver.depth / 2 && maxZ > otherRiver.z - otherRiver.depth / 2) {
        if (w > d) {
          if (otherRiver.id !== 'yangtze-west' && minX < otherRiver.x - otherRiver.width / 2) {
            addBank(minX, otherRiver.x - otherRiver.width / 2, minZ, maxZ);
          }
          if (maxX > otherRiver.x + otherRiver.width / 2) {
            addBank(otherRiver.x + otherRiver.width / 2, maxX, minZ, maxZ);
          }
        } else {
          if (minZ < otherRiver.z - otherRiver.depth / 2) {
            addBank(minX, maxX, minZ, otherRiver.z - otherRiver.depth / 2);
          }
          if (maxZ > otherRiver.z + otherRiver.depth / 2) {
            addBank(minX, maxX, otherRiver.z + otherRiver.depth / 2, maxZ);
          }
        }
        return;
      }
      const horizontal = w > d;
      const start = horizontal ? minX : minZ, end = horizontal ? maxX : maxZ;
      const segments = Math.ceil((end - start) / 3);
      const landSide = Math.sign(horizontal ? (minZ + maxZ) / 2 - z : (minX + maxX) / 2 - x);
      const bendAt = along => {
        let fade = Math.min(1, (along - start) / 4, (end - along) / 4);
        for (const crossing of crossings) {
          fade = Math.min(fade, Math.max(0, (Math.abs(along - crossing.x) - crossing.width / 2) / 5));
        }
        return Math.max(0, fade) * (1.3 + .8 * Math.sin(along * .095 + landSide * 1.7) +
          .45 * Math.sin(along * .31 + landSide));
      };
      for (let segment = 0; segment < segments; segment++) {
        const from = start + (end - start) * segment / segments;
        const to = start + (end - start) * (segment + 1) / segments;
        const edge = addBox(horizontal ? (from + to) / 2 : (minX + maxX) / 2, -1.5,
          horizontal ? (minZ + maxZ) / 2 : (from + to) / 2,
          horizontal ? to - from : maxX - minX, 3.1, horizontal ? maxZ - minZ : to - from, stone);
        const positions = edge.geometry.attributes.position, uv = edge.geometry.attributes.uv;
        const normals = edge.geometry.attributes.normal, meters = stone.userData.metersPerTile ?? 2.4;
        for (let index = 0; index < positions.count; index++) {
          const across = horizontal ? positions.getZ(index) : positions.getX(index);
          const along = (horizontal ? edge.position.x : edge.position.z) +
            (horizontal ? positions.getX(index) * edge.scale.x : positions.getZ(index) * edge.scale.z);
          if (across * landSide < 0) {
            const offset = -landSide * bendAt(along);
            if (horizontal) positions.setZ(index, across + offset / edge.scale.z);
            else positions.setX(index, across + offset / edge.scale.x);
          }
          if (positions.getY(index) > 0) {
            positions.setY(index, .5 - (across * landSide < 0 ? .7 / 3.1 : 0));
          }
          uv.setXY(index,
            (Math.abs(normals.getX(index)) > .5 ? positions.getZ(index) * edge.scale.z : positions.getX(index) * edge.scale.x) / meters,
            (Math.abs(normals.getY(index)) > .5 ? positions.getZ(index) * edge.scale.z : positions.getY(index) * edge.scale.y) / meters);
        }
        edge.geometry.computeVertexNormals();
        edge.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(edge);
        obstacles.push({ minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z,
          maxZ: bounds.max.z, height: 2 });
        edge.userData.nanjingFeature = 'river-stone-bank';
        edge.userData.bankProfile = 'meandering-sloped-revetment';
        edge.userData.riverId = horizontal ? 'qinhuai-south' : 'yangtze-west';
        edge.userData.shoreline = { from, to, startInset: bendAt(from), endInset: bendAt(to) };
      }
    };
    const addBankSegments = (minX, maxX, minZ, maxZ, gaps) => {
      let start = minX;
      for (const gap of gaps.sort((a, b) => a.min - b.min)) {
        if (gap.min > start) addBank(start, Math.min(gap.min, maxX), minZ, maxZ);
        start = Math.max(start, gap.max);
      }
      if (start < maxX) addBank(start, maxX, minZ, maxZ);
    };
    if (w > d) {
      const gaps = crossings.map(crossing => ({
        min: crossing.x - crossing.width / 2, max: crossing.x + crossing.width / 2,
      }));
      // Deep water is impassable; only the stone bridge carries ground traffic.
      let waterStart = x - w / 2;
      for (const gap of [...gaps].sort((a, b) => a.min - b.min)) {
        if (gap.min > waterStart) obstacles.push({ minX: waterStart, maxX: gap.min,
          minZ: z - d / 2, maxZ: z + d / 2, height: 2, water: true });
        waterStart = Math.max(waterStart, gap.max);
      }
      if (waterStart < x + w / 2) obstacles.push({ minX: waterStart, maxX: x + w / 2,
        minZ: z - d / 2, maxZ: z + d / 2, height: 2, water: true });
      for (const edge of [-1, 1]) {
        const bankZ = z + edge * (d / 2 - bank / 2);
        addBankSegments(x - w / 2, x + w / 2, bankZ - bank / 2, bankZ + bank / 2, gaps);
      }
    } else {
      const dockEdge = NANJING_DOCK.x - 7;
      obstacles.push(
        { minX: x + w / 2 - NANJING_FERRY_ROUTE.riverWidth, maxX: dockEdge,
          minZ: z - NANJING_FERRY_ROUTE.riverDepth / 2, maxZ: z + NANJING_FERRY_ROUTE.riverDepth / 2, height: 2, water: true },
        { minX: dockEdge, maxX: x + w / 2, minZ: z - d / 2, maxZ: NANJING_PIER.minZ, height: 2, water: true },
        { minX: dockEdge, maxX: x + w / 2, minZ: NANJING_PIER.maxZ, maxZ: z + d / 2, height: 2, water: true },
      );
      for (const edge of [1]) {
        const bankX = x + edge * (w / 2 - bank / 2);
        const gaps = edge === 1 ? [{ min: NANJING_PIER.minZ, max: NANJING_PIER.maxZ }] : [];
        let start = z - d / 2;
        for (const gap of gaps) {
          if (gap.min > start) addBank(bankX - bank / 2, bankX + bank / 2, start, gap.min);
          start = Math.max(start, gap.max);
        }
        if (start < z + d / 2) addBank(bankX - bank / 2, bankX + bank / 2, start, z + d / 2);
      }
    }
  }

  function makeStoneBridge(x, z, width, length, axis = 'z') {
    const dimensions = axis === 'z' ? [width, length] : [length, width];
    const deck = addBox(x, -.3, z, dimensions[0], .6, dimensions[1], stone);
    deck.userData.nanjingFeature = 'stone-bridge';
    const roadbed = makeSurface(x, z, dimensions[0] - 1.4, dimensions[1] - 1.4, road, .01);
    roadbed.userData.nanjingFeature = 'bridge-roadway';
    const roadUV = roadbed.geometry.attributes.uv;
    for (let index = 0; index < roadUV.count; index++) {
      roadUV.setXY(index, roadUV.getX(index) * (dimensions[0] - 1.4) / 1.2,
        roadUV.getY(index) * (dimensions[1] - 1.4) / 1.2);
    }
    const span = (length - 12) / 3;
    for (let archIndex = 0; archIndex < 3; archIndex++) {
      const center = -span + archIndex * span;
      const arch = new THREE.Shape();
      arch.moveTo(-span / 2, -.6); arch.lineTo(span / 2, -.6);
      arch.lineTo(span / 2, -2.8);
      arch.absellipse(0, -2.8, span / 2, 1.65, 0, Math.PI, false);
      arch.lineTo(-span / 2, -.6); arch.closePath();
      const masonry = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: width, bevelEnabled: false }), stone);
      if (axis === 'z') {
        masonry.rotation.y = -Math.PI / 2;
        masonry.position.set(x + width / 2, 0, z + center);
      } else masonry.position.set(x + center, 0, z - width / 2);
      masonry.castShadow = masonry.receiveShadow = true;
      masonry.userData.nanjingFeature = 'bridge-stone-arch';
      scene.add(masonry); solids.push(masonry);
    }
    for (const offset of [-1.5, -.5, .5, 1.5]) {
      const pier = axis === 'z'
        ? addBox(x, -1.7, z + offset * span, width + .5, 2.2, 1, stone)
        : addBox(x + offset * span, -1.7, z, 1, 2.2, width + .5, stone);
      pier.userData.nanjingFeature = 'bridge-pier';
    }
    const railLength = length - 8;
    for (const side of [-1, 1]) {
      const rail = axis === 'z'
        ? addBox(x + side * (width / 2 - .45), .65, z, .9, 1.3, railLength, stone, true)
        : addBox(x, .65, z + side * (width / 2 - .45), railLength, 1.3, .9, stone, true);
      rail.userData.nanjingFeature = 'bridge-parapet';
    }
    for (let offset = -railLength / 2 + 1; offset <= railLength / 2 - 1; offset += 6) {
      const coping = axis === 'z'
        ? addBox(x + width / 2 - .45, 1.42, z + offset, 1.2, .24, 1.2, stone, true)
        : addBox(x + offset, 1.42, z + width / 2 - .45, 1.2, .24, 1.2, stone, true);
      coping.userData.nanjingFeature = 'bridge-coping';
      const opposite = axis === 'z'
        ? addBox(x - width / 2 + .45, 1.42, z + offset, 1.2, .24, 1.2, stone, true)
        : addBox(x + offset, 1.42, z - width / 2 + .45, 1.2, .24, 1.2, stone, true);
      opposite.userData.nanjingFeature = 'bridge-coping';
    }
    return { x, z, width, length, axis, type: 'stone-bridge' };
  }

  function makePlaque(text, x, y, z, width, height, stoneStyle = false, front = 1, axis = 'z') {
    const material = new THREE.MeshStandardMaterial({ color: stoneStyle ? 0xb9ae91 : 0x33291f, roughness: .95 });
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Landmark lettering requires a working canvas');
      context.fillStyle = stoneStyle ? '#b9ae91' : '#33291f'; context.fillRect(0, 0, 512, 160);
      context.strokeStyle = stoneStyle ? '#82765c' : '#8c7952'; context.lineWidth = 5; context.strokeRect(9, 9, 494, 142);
      context.fillStyle = stoneStyle ? '#302d26' : '#d2bd86';
      context.font = 'bold 112px KaiTi, STKaiti, SimSun, serif';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText([...text].reverse().join(''), 256, 84, 460);
      material.map = new THREE.CanvasTexture(canvas); material.map.colorSpace = THREE.SRGBColorSpace;
      material.color.setHex(0xffffff);
    }
    material.userData.lettering = { text, order: 'right-to-left', historicalHandwritingReplica: false,
      rasterized: Boolean(material.map) };
    if (axis === 'x')
      addBox(x - front * .07, y, z, .16, height + .14, width + .16, stoneStyle ? stone : timber);
    else addBox(x, y, z - front * .07, width + .16, height + .14, .16, stoneStyle ? stone : timber);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    plaque.position.set(x + (axis === 'x' ? front * .018 : 0), y, z + (axis === 'z' ? front * .018 : 0));
    plaque.rotation.y = axis === 'x' ? front * Math.PI / 2 : front < 0 ? Math.PI : 0;
    plaque.userData.nanjingFeature = 'landmark-plaque';
    plaque.userData.text = text; scene.add(plaque); solids.push(plaque);
    return plaque;
  }

  function makeGatewayArch(z, opening, spring, depth) {
    const radius = opening / 2;
    const archstones = [];
    for (let index = 0; index < 11; index++) {
      const start = Math.PI * index / 11, end = Math.PI * (index + 1) / 11;
      const outer = radius + .5 * DETAIL_SCALE, inner = radius + .015;
      const section = new THREE.Shape();
      section.absarc(0, spring, outer, start, end, false);
      section.lineTo(Math.cos(end) * inner, spring + Math.sin(end) * inner);
      section.absarc(0, spring, inner, end, start, true);
      section.closePath();
      const voussoir = new THREE.Mesh(new THREE.ExtrudeGeometry(section,
        { depth: .12, bevelEnabled: false, curveSegments: 4 }), warmBrick);
      voussoir.position.set(0, 0, z - depth / 2 - .12);
      voussoir.castShadow = voussoir.receiveShadow = true;
      voussoir.userData.nanjingFeature = 'arched-gateway';
      scene.add(voussoir);
      solids.push(voussoir);
      archstones.push(voussoir);
      const rear = voussoir.clone();
      rear.position.z = z + depth / 2;
      scene.add(rear); solids.push(rear);
    }
    return { archstones };
  }

  function makeGate(z, main = false) {
    const height = main ? NANJING_GATE_HEIGHT : NANJING_RAMPART_HEIGHT;
    const wallHeight = Math.max(height, WALL_WALK.height);
    const width = GATE_WIDTH;
    const opening = NANJING_GATE_TUNNEL.width;
    const depth = NANJING_GATE_TUNNEL.depth;
    for (const side of [-1, 1]) {
      const segmentWidth = width / 2 - opening / 2;
      const wing = { minX: side < 0 ? -width / 2 : opening / 2,
        maxX: side < 0 ? -opening / 2 : width / 2,
        minZ: z - depth / 2, maxZ: z + depth / 2, minY: 0, maxY: wallHeight };
      obstacles.push(...subtractCasemateBox(wing).map(({ maxY, ...bounds }) =>
        ({ ...bounds, height: maxY, walkable: maxY === NANJING_CASEMATE.floorY })));
      town.pieces.push({ x: side * (opening / 2 + segmentWidth / 2), y: wallHeight / 2, z,
        w: segmentWidth, h: wallHeight, d: depth, material: 'stone', wall: true });
      const niche = addBox(side * (opening / 2 + 1.15 * DETAIL_SCALE), 2.1 * DETAIL_SCALE, z,
        .1 * DETAIL_SCALE, 1.4 * DETAIL_SCALE, 1.8 * DETAIL_SCALE, dark);
      niche.castShadow = false;
      niche.userData.nanjingFeature = 'gate-guard-niche';
      for (const offset of [-1.6, 1.6].map(value => value * DETAIL_SCALE)) {
        town.covers.push({ id: `gate-cover-${z}-${side}-${offset}`,
          x: side * (opening / 2 + 1.2 * DETAIL_SCALE), z: z + offset, kind: 'corner' });
      }
    }
    const archSpring = NANJING_GATE_TUNNEL.height - opening / 2;
    const arch = makeGatewayArch(z, opening, archSpring, depth);
    const archCrown = archSpring + opening / 2 + .55 * DETAIL_SCALE;
    const masonry = new THREE.Shape();
    masonry.moveTo(-width / 2, 0);
    masonry.lineTo(-opening / 2, 0);
    masonry.lineTo(-opening / 2, archSpring);
    masonry.absarc(0, archSpring, opening / 2, Math.PI, 0, true);
    masonry.lineTo(opening / 2, 0);
    masonry.lineTo(width / 2, 0);
    masonry.lineTo(width / 2, wallHeight);
    masonry.lineTo(-width / 2, wallHeight);
    masonry.closePath();
    const material = main ? brick : warmBrick, meters = material.userData.metersPerTile ?? 2.4;
    for (const slice of casemateGateSlices(z - depth / 2, z + depth / 2)) {
      const shape = masonry.clone();
      for (const opening of slice.holes) {
        const hole = new THREE.Path();
        hole.moveTo(opening.minX, opening.minY); hole.lineTo(opening.maxX, opening.minY);
        hole.lineTo(opening.maxX, opening.maxY); hole.lineTo(opening.minX, opening.maxY); hole.closePath();
        shape.holes.push(hole);
      }
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: slice.maxZ - slice.minZ,
        bevelEnabled: false, curveSegments: 24 });
      const uv = geometry.attributes.uv, positions = geometry.attributes.position, normals = geometry.attributes.normal;
      for (let vertex = 0; vertex < uv.count; vertex++)
        uv.setXY(vertex, (Math.abs(normals.getX(vertex)) > .5 ? positions.getZ(vertex) + slice.minZ - (z - depth / 2) : positions.getX(vertex)) / meters,
          (Math.abs(normals.getY(vertex)) > .5 ? positions.getZ(vertex) + slice.minZ : positions.getY(vertex)) / meters);
      const aboveArch = new THREE.Mesh(geometry, material);
      aboveArch.position.set(0, 0, slice.minZ);
      aboveArch.castShadow = aboveArch.receiveShadow = true;
      scene.add(aboveArch); solids.push(aboveArch);
      aboveArch.userData.nanjingFeature = 'gate-above-arch-masonry';
    }
    obstacles.push({ minX: -opening / 2, maxX: opening / 2, minZ: z - depth / 2,
      maxZ: z + depth / 2, minY: archCrown, height: wallHeight });
    if (main) {
      const plaque = makePlaque('中華門', 0, archCrown + .95, z + depth / 2 + .10, 3.2, 1, true);
      plaque.userData.nanjingFeature = 'gate-name-plaque';
      const front = z + depth / 2;
      for (const [index, [x, y, radius]] of [
        [-4.6, 2.45, .76], [-5.4, 3.1, .32], [-3.9, 1.65, .25],
        [-7.2, 4.65, .41], [-8.1, 4.2, .22], [-5.8, 5.85, .27],
        [3.65, 3.45, .54], [4.1, 2.55, .28], [5.0, 3.85, .34],
        [8.2, 5.2, .63], [9.05, 4.65, .26], [7.6, 5.8, .21],
      ].entries()) shellPocks(x, y, front, radius, 105 + index, 1);
    }
    const passageCenters = NANJING_WALL_WALKS.map(walk => (walk.minX + walk.maxX) / 2);
    const intervals = [[-width / 2, passageCenters[0] - 1.45],
      [passageCenters[0] + 1.45, passageCenters[1] - 1.45],
      [passageCenters[1] + 1.45, width / 2]];
    for (const edge of [-1, 1]) {
      const sections = edge < 0 && z === NANJING_GATE_POSITIONS[0] ? [[-width / 2, width / 2]] : intervals;
      for (const [min, max] of sections)
        makeParapet('x', min, max, z + edge * (depth / 2 - .3), wallHeight,
          { height: main && edge > 0 ? 1.5 : 1 });
    }
    if (main) {
      for (let index = 0; index < 22; index++) {
        const rubbleHeight = (.3 + index % 3 * .14) * DETAIL_SCALE;
        const side = index % 2 ? 1 : -1;
        const x = side * (3.15 + index % 7 * .29 + Math.sin(index * 2.7) * .34);
        const rubble = addBox(x, rubbleHeight / 2,
          z + depth / 2 + .22 + index % 5 * .25, (.45 + index % 3 * .15) * DETAIL_SCALE,
          rubbleHeight, (.5 + index % 4 * .12) * DETAIL_SCALE, index % 3 ? brick : stone);
        rubble.rotation.y = index * .73;
        rubble.userData.nanjingFeature = 'gate-rubble';
      }
    }
    return { x: 0, z, width, height: wallHeight, opening, depth, main,
      archstones: arch.archstones.length };
  }

  makeSurface(NANJING_DOCK_SHIFT / 2, 0, 216 - NANJING_DOCK_SHIFT, 216, ground);
  const northGround = makeSurface((NANJING_RIVER_SHORE_X + 600) / 2, -454,
    600 - NANJING_RIVER_SHORE_X, 692, ground, -.16, false);
  northGround.userData.nanjingFeature = 'north-distant-ground';
  const northBank = new THREE.Mesh(new THREE.BoxGeometry(3, 3.1, 650), stone);
  northBank.position.set(NANJING_RIVER_SHORE_X - 1.5, -1.5, -475);
  northBank.userData.nanjingFeature = 'north-distant-bank';
  scene.add(northBank);
  makeSurface(0, 48, 12, 120, road, -.08);
  makeSurface(-43, 10, 56, 4, road, -.07);
  for (const [streetIndex, street] of cityLayout.streets.entries()) {
    for (let index = 1; index < street.points.length; index++) {
      const [ax, az] = street.points[index - 1], [bx, bz] = street.points[index];
      const length = Math.hypot(bx - ax, bz - az);
      const elevation = -.145 + (streetIndex * 2 + index % 2) * .004;
      const paving = makeSurface((ax + bx) / 2, (az + bz) / 2, street.width, length + .35, road, elevation, false);
      paving.rotation.z = Math.atan2(bx - ax, bz - az);
      paving.userData.nanjingFeature = 'city-lane';
      paving.userData.streetId = street.id;
    }
  }
  const utilityWire = new THREE.MeshStandardMaterial({ color: 0x343632, roughness: .88 });
  const utilityTimber = surface('timber', 0x554633, 2.6);
  const streetLampMetal = new THREE.MeshStandardMaterial({ color: 0x47483f, roughness: .82, metalness: .34 });
  const streetLampGlass = new THREE.MeshStandardMaterial({
    color: 0x9b8762, emissive: 0x302514, roughness: .8,
  });
  for (const fixture of cityLayout.streetFixtures) {
    const { x, z } = fixture;
    if (fixture.kind === 'utility') {
      cityBeam([x, 0, z], [x, 6, z], .12, utilityTimber, true);
      cityBeam([x - .85, 5.55, z], [x + .85, 5.55, z], .055, utilityTimber, true);
      for (const offset of [-.58, 0, .58]) {
        const insulator = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .16, 6), stone);
        insulator.position.set(x + offset, 5.65, z);
        scene.add(insulator);
        solids.push(insulator);
      }
      obstacles.push({ minX: x - .24, maxX: x + .24, minZ: z - .24, maxZ: z + .24,
        minY: 0, height: 6 });
      sceneArt.cityInfrastructure.utilityPoles++;
    } else if (fixture.kind === 'streetlamp') {
      cityBeam([x, 0, z], [x, 4.5, z], .085, streetLampMetal, true);
      const armX = x > 0 ? x - 1 : x + 1;
      cityBeam([x, 4.18, z], [armX, 4.45, z], .045, streetLampMetal, true);
      addBox(armX, 4.3, z, .3, .12, .23, streetLampMetal);
      addBox(armX, 4.15, z, .2, .09, .16, streetLampGlass);
      obstacles.push({ minX: x - .2, maxX: x + .2, minZ: z - .2, maxZ: z + .2,
        minY: 0, height: 4.5 });
      sceneArt.cityInfrastructure.streetLamps++;
    }
  }
  for (const side of [-1, 1]) {
    const poles = cityLayout.streetFixtures.filter(fixture => fixture.kind === 'utility' &&
      Math.sign(fixture.x) === side).sort((a, b) => a.z - b.z);
    for (let index = 1; index < poles.length; index++) {
      const a = poles[index - 1], b = poles[index];
      for (const offset of [-.58, 0, .58]) {
        const x = (a.x + b.x) / 2 + offset, midZ = (a.z + b.z) / 2;
        cityBeam([x, 5.65, a.z], [x, 5.35, midZ], .018, utilityWire);
        cityBeam([x, 5.35, midZ], [x, 5.65, b.z], .018, utilityWire);
      }
      sceneArt.cityInfrastructure.overheadWireSpans++;
    }
  }
  makeSurface(-24, 76, 10, 58, road, -.07);
  makeSurface(-12, 38, 24, 8, road, -.06);
  makeRiver(RIVERS[0].x, 52, RIVERS[0].width, 26, [YUHUA_BRIDGE]);
  makeRiver(NANJING_RIVER_SHORE_X - 12, 0, 24, 300);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xb4c3b4, transparent: true, opacity: .18, depthWrite: false });
  waterWaves.attach(rippleMaterial, 'z');
  for (let index = 0; index < 72; index++) {
    const ripple = makeSurface(-68 + (index * 17.31 % 164), 40 + (index * 7.73 % 23),
      .5 + index % 5 * .3, .025, rippleMaterial, SOUTH_RIVER_WATER + .025);
    ripple.rotation.z = Math.sin(index * 2.4) * .15;
    ripple.userData.nanjingFeature = 'river-ripple';
  }

  const gateways = STONE_WALLS.map(z => makeGate(z, z === NANJING_GATE_Z));
  const damagedWallBrick = brick.clone();
  damagedWallBrick.onBeforeCompile = brick.onBeforeCompile;
  damagedWallBrick.customProgramCacheKey = brick.customProgramCacheKey;
  damagedWallBrick.vertexColors = true;
  const damagedWallFaces = [];
  function applyWallDamage(wall, side) {
    const rotated = side === 'west';
    const { x, z } = wall.position;
    const { x: width, y: height, z: depth } = wall.scale;
    const center = rotated ? -z : x, length = rotated ? depth : width, thickness = rotated ? width : depth;
    const face = new THREE.Mesh(nanjingDamagedWallGeometry(side, center - length / 2, center + length / 2,
      height, thickness, brick.userData.metersPerTile ?? 2.4), damagedWallBrick);
    face.position.copy(wall.position);
    face.scale.set(length, height, thickness);
    if (rotated) face.rotation.y = Math.PI / 2;
    face.castShadow = face.receiveShadow = true;
    scene.add(face);
    damagedWallFaces.push(face);
    wall.userData.nanjingBattleDamage = side;
    wall.updateMatrixWorld(true);
    scene.remove(wall);
  }
  const damagedMerlon = (side, x) => [-.65, -.3, 0, .3, .65].some(dx => nanjingWallNotch(side, x + dx) > .025);
  const westInnerLedge = (minZ, maxZ) => {
    const ledge = addBox(-69.775, WALL_WALK.height - .12, (minZ + maxZ) / 2,
      .85, .24, maxZ - minZ, brick, true);
    ledge.userData.nanjingFeature = 'brick-parapet-ledge';
    obstacles.at(-1).walkable = true;
    flankWalkSupports.push({ minX: -70.2, maxX: -69.35, minZ, maxZ, height: WALL_WALK.height });
  };
  const northernWall = addBox(16, 5, -113, 180, 10, 4.4, brick);
  northernWall.userData.nanjingFeature = 'northern-city-wall';
  applyWallDamage(northernWall, 'north');
  for (const z of [-114.9, -111.1])
    makeParapet('x', -74, 106, z, 10,
      { collision: false, height: z < -113 ? 1.5 : 1, damaged: x => damagedMerlon('north', x) });
  for (const bounds of NANJING_CITY_WALLS) {
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const x = (bounds.minX + bounds.maxX) / 2, z = (bounds.minZ + bounds.maxZ) / 2;
    const breach = wallBreaches.find(gap => gap.minX > bounds.minX && gap.maxX < bounds.maxX &&
      gap.minZ === bounds.minZ && gap.maxZ === bounds.maxZ);
    const sections = breach ? [{ ...bounds, maxX: breach.minX }, { ...bounds, minX: breach.maxX }] : [bounds];
    for (const section of sections) {
      const wall = addBox((section.minX + section.maxX) / 2, WALL_WALK.height / 2, z,
        section.maxX - section.minX, WALL_WALK.height, depth, brick, true, true);
      wall.userData.nanjingFeature = 'city-wall';
      applyWallDamage(wall, width > depth ? 'south' : 'west');
      flankWalkSupports.push({ ...section, height: WALL_WALK.height });
    }
    if (breach) {
      for (const side of [-1, 1]) for (let level = 0; level < 5; level++) {
        const tooth = addBox(side < 0 ? breach.minX + .16 : breach.maxX - .16,
          .45 + level * 1.65, z, .32, .9, depth, brick, true);
        tooth.userData.nanjingFeature = 'blast-broken-wall-edge';
      }
    }
    const horizontal = width > depth;
    if (!horizontal && bounds.minX === -74.2) westInnerLedge(bounds.minZ, bounds.maxZ);
    for (const section of sections) for (const edge of [-1, 1]) {
      const fixed = horizontal ? (edge < 0 ? bounds.minZ + .3 : bounds.maxZ - .3)
        : (edge < 0 ? bounds.minX + .3 : bounds.minX === -74.2 ? -69.45 : bounds.maxX - .3);
      const min = horizontal && edge < 0 && section.minX === -74.2 ? -69.8
        : horizontal ? section.minX : section.minZ;
      makeParapet(horizontal ? 'x' : 'z', min,
        horizontal ? section.maxX : section.maxZ, fixed, WALL_WALK.height,
        { height: (horizontal ? edge > 0 : edge < 0) ? 1.5 : 1,
          damaged: position => damagedMerlon(horizontal ? 'south' : 'west', horizontal ? position : -position) });
    }
    if (horizontal && bounds.minX === -74.2)
      makeParapet('z', bounds.minZ, bounds.maxZ, bounds.minX + .3, WALL_WALK.height, { height: 1.5 });
  }
  for (const [x, minZ, maxZ, feature] of [
    [-72, -113, NANJING_WEST_BREACH.minZ, 'west-city-wall'],
    [-72, NANJING_WEST_BREACH.maxZ, NANJING_WEST_GATE_Z - NANJING_WEST_GATE_HALF_WIDTH, 'west-city-wall'],
    [105, -113, 16, 'east-city-wall'],
  ]) {
    const z = (minZ + maxZ) / 2, depth = maxZ - minZ;
    const wall = addBox(x, WALL_WALK.height / 2, z, 4.4, WALL_WALK.height, depth, brick, true, true);
    wall.userData.nanjingFeature = feature;
    applyWallDamage(wall, 'west');
    if (feature === 'west-city-wall' && minZ === NANJING_WEST_BREACH.maxZ) {
      flankWalkSupports.push({ minX: x - 2.2, maxX: x + 2.2, minZ, maxZ, height: WALL_WALK.height });
    }
    if (feature === 'west-city-wall') {
      if (minZ < -74.05 && maxZ > -73.45) {
        westInnerLedge(minZ, -80.3);
        westInnerLedge(-73, maxZ);
      } else westInnerLedge(minZ, maxZ);
    }
    for (const edge of [-1, 1]) {
      const segments = feature === 'west-city-wall' && edge === 1 && minZ < -74.05 && maxZ > -73.45
        ? [[minZ, -80.3], [-73, maxZ]] : [[minZ, maxZ]];
      for (const [start, end] of segments)
        makeParapet('z', start, end,
          feature === 'west-city-wall' && edge === 1 ? -69.45 : x + edge * 1.9, WALL_WALK.height,
          { height: (feature === 'west-city-wall' ? edge < 0 : edge > 0) ? 1.5 : 1,
            damaged: position => damagedMerlon('west', -position) });
    }
  }
  for (const side of [-1, 1]) for (let level = 0; level < 8; level++) {
    const depth = [.85, 1.05, .72, .95, .53, .78, .4, .62][side < 0 ? level : 7 - level];
    const tooth = addBox(-72, (level + .5) * 1.25,
      side < 0 ? NANJING_WEST_BREACH.minZ + depth / 2 : NANJING_WEST_BREACH.maxZ - depth / 2,
      4.4, 1.25, depth, brick, true);
    tooth.userData.nanjingFeature = 'blast-broken-wall-edge';
  }
  const breachGeometry = new THREE.BufferGeometry(), breachVertices = [], breachUVs = [], breachIndices = [];
  const breachColumns = 41, breachRows = 25;
  for (let row = 0; row < breachRows; row++) for (let column = 0; column < breachColumns; column++) {
    const x = -77 + column * .25, z = -92 + row * .25;
    breachVertices.push(x, breachHeight(x, z), z);
    breachUVs.push(x / .9, z / .9);
    if (row && column) {
      const current = row * breachColumns + column;
      breachIndices.push(current - breachColumns - 1, current - 1, current - breachColumns,
        current - 1, current, current - breachColumns);
    }
  }
  breachGeometry.setAttribute('position', new THREE.Float32BufferAttribute(breachVertices, 3));
  breachGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(breachUVs, 2));
  breachGeometry.setIndex(breachIndices);
  breachGeometry.computeVertexNormals();
  const breachSurface = new THREE.Mesh(breachGeometry, brick);
  breachSurface.userData.nanjingFeature = 'west-breach-slope';
  breachSurface.receiveShadow = true;
  scene.add(breachSurface); solids.push(breachSurface);
  const breachRubble = new THREE.InstancedMesh(boxGeometry, brick, 100);
  const breachBrick = new THREE.Object3D();
  for (let i = 0; i < 100; i++) {
    const x = -77 + ((i * .618034) % 1) * 10, z = -92 + ((i * .414214) % 1) * 6;
    const size = .12 + (i % 5) * .035;
    breachBrick.position.set(x, breachHeight(x, z) + size * .15, z);
    breachBrick.rotation.set(.08 * Math.sin(i), i * 2.04, .08 * Math.cos(i));
    breachBrick.scale.set(size * 1.8, size * .65, size);
    breachBrick.updateMatrix();
    breachRubble.setMatrixAt(i, breachBrick.matrix);
  }
  breachRubble.receiveShadow = true;
  breachRubble.userData.nanjingFeature = 'west-breach-rubble';
  scene.add(breachRubble);
  const westGateShape = new THREE.Shape();
  const westGateSpring = 2.4, westGateRadius = NANJING_WEST_GATE_HALF_WIDTH;
  westGateShape.moveTo(-westGateRadius, westGateSpring);
  westGateShape.absarc(0, westGateSpring, westGateRadius, Math.PI, 0, true);
  westGateShape.lineTo(westGateRadius, WALL_WALK.height);
  westGateShape.lineTo(-westGateRadius, WALL_WALK.height);
  westGateShape.closePath();
  const westGate = new THREE.Mesh(new THREE.ExtrudeGeometry(westGateShape,
    { depth: 4.4, bevelEnabled: false, curveSegments: 24 }), brick);
  westGate.rotation.y = Math.PI / 2;
  westGate.position.set(-74.2, 0, NANJING_WEST_GATE_Z);
  westGate.castShadow = westGate.receiveShadow = true;
  westGate.userData.nanjingFeature = 'west-city-gate';
  scene.add(westGate); solids.push(westGate);
  obstacles.push({ minX: -74.2, maxX: -69.8, minZ: NANJING_WEST_GATE_Z - westGateRadius,
    maxZ: NANJING_WEST_GATE_Z + westGateRadius, minY: westGateSpring, height: WALL_WALK.height });
  flankWalkSupports.push({ minX: -74.2, maxX: -69.8,
    minZ: NANJING_WEST_GATE_Z - westGateRadius, maxZ: NANJING_WEST_GATE_Z + westGateRadius,
    height: WALL_WALK.height });
  const westGateStair = { minX: -69.8, maxX: -68, groundX: -66.2,
    minZ: -79.9, turnZ: -77.8, topZ: -74.05, height: WALL_WALK.height };
  const stairHalfHeight = westGateStair.height / 2;
  const stairSteps = Math.ceil(stairHalfHeight / .15);
  const flightLength = 3.75, stepDepth = flightLength / stairSteps;
  const stairWidth = westGateStair.maxX - westGateStair.minX;
  for (let step = 0; step < stairSteps; step++) {
    const height = stairHalfHeight * (step + 1) / stairSteps;
    const lower = addBox((westGateStair.maxX + westGateStair.groundX) / 2, height / 2,
      westGateStair.topZ - (step + .5) * stepDepth, stairWidth, height, stepDepth, stone);
    lower.userData.nanjingFeature = 'west-gate-stair-tread';
    const upperHeight = stairHalfHeight + height;
    const upper = addBox((westGateStair.minX + westGateStair.maxX) / 2, upperHeight / 2,
      westGateStair.turnZ + (step + .5) * stepDepth, stairWidth, upperHeight, stepDepth, stone);
    upper.userData.nanjingFeature = 'west-gate-stair-tread';
  }
  for (const landing of [
    { minX: westGateStair.minX, maxX: westGateStair.groundX, minZ: westGateStair.minZ,
      maxZ: westGateStair.turnZ, height: stairHalfHeight },
    { minX: westGateStair.minX, maxX: westGateStair.maxX, minZ: westGateStair.topZ,
      maxZ: westGateStair.topZ + .6, height: westGateStair.height },
  ]) {
    const mesh = addBox((landing.minX + landing.maxX) / 2, landing.height / 2,
      (landing.minZ + landing.maxZ) / 2, landing.maxX - landing.minX, landing.height,
      landing.maxZ - landing.minZ, stone);
    mesh.userData.nanjingFeature = 'west-gate-stair-tread';
    flankWalkSupports.push(landing);
  }
  for (const side of [-1, 1]) {
    const plaque = makePlaque('水西門', side < 0 ? -74.2 : -69.8, 6.4,
      NANJING_WEST_GATE_Z, 2.5, .8, true, side, 'x');
    plaque.userData.nanjingFeature = 'west-gate-name';
  }
  westInnerLedge(NANJING_WEST_GATE_Z - westGateRadius, NANJING_WEST_GATE_Z + westGateRadius);
  for (const x of [-73.9, -69.45])
    makeParapet('z', NANJING_WEST_GATE_Z - westGateRadius,
      NANJING_WEST_GATE_Z + westGateRadius, x, WALL_WALK.height, { height: x < -72 ? 1.5 : 1 });
  const fallenBrick = new THREE.InstancedMesh(boxGeometry, brick, NANJING_WALL_PLUMES.length * 38);
  const fallenPose = new THREE.Object3D();
  for (const [side, { x, z, heading }] of NANJING_WALL_PLUMES.entries()) {
    for (let i = 0; i < 38; i++) {
      const scatter = i * .618034 % 1;
      const height = .14 + (1 - scatter) ** 2 * (.29 + i % 5 * .09);
      const along = Math.sin(i * 3.87) * (.7 + scatter * 4.4);
      const outward = .46 + scatter ** 1.5 * 3.6 + (i % 3) * .26;
      fallenPose.position.set(x + Math.cos(heading) * along + Math.sin(heading) * outward,
        height * .37, z - Math.sin(heading) * along + Math.cos(heading) * outward);
      fallenPose.rotation.set(i * .83 % .57, i * 2.04, i * .62 % .54);
      fallenPose.scale.set(height * (1.4 + (i % 3) * .55), height, height * 1.36);
      fallenPose.updateMatrix();
      const index = side * 38 + i;
      fallenBrick.setMatrixAt(index, fallenPose.matrix);
      fallenBrick.setColorAt(index, new THREE.Color().setRGB(.55 + scatter * .36, .51 + scatter * .38, .44 + scatter * .42));
    }
  }
  fallenBrick.receiveShadow = true;
  fallenBrick.userData.nanjingFeature = 'wall-foot-rubble';
  scene.add(fallenBrick);
  for (const spec of [
    { text: '誓死保卫南京', lines: ['誓死保卫南京'], x: -30, width: 8, height: 2 },
    { text: '地无分南北，年无分老幼，无论何人，皆有守土抗战之责',
      lines: ['地无分南北，年无分老幼，', '无论何人，皆有守土抗战之责'], x: 55, width: 20, height: 5 },
    { text: '誓死保卫南京', lines: ['誓死保卫南京'], x: -74.23, z: -102.5, rotation: -Math.PI / 2, width: 8, height: 2 },
  ]) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, depthWrite: false, roughness: 1 });
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = spec.lines.length === 1 ? 1024 : 2048;
      canvas.height = spec.lines.length === 1 ? 256 : 512;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Nanjing wall slogans require a working canvas');
      context.fillStyle = '#d8d0bc';
      const fontSize = spec.lines.length === 1 ? 180 : 140;
      context.font = `bold ${fontSize}px KaiTi, STKaiti, SimSun, serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
      let seed = spec.lines.length === 1 ? 1937 : 193712;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      spec.lines.forEach((line, index) => {
        const glyphs = [...line], widths = glyphs.map(glyph => context.measureText(glyph).width);
        const total = widths.reduce((sum, width) => sum + width, 0);
        context.save();
        context.translate(canvas.width / 2, canvas.height * (spec.lines.length === 1 ? .5 : .34 + index * .32));
        context.scale(Math.min(1, canvas.width * .96 / total), 1);
        let x = -total / 2;
        glyphs.forEach((glyph, i) => {
          context.save();
          context.translate(x + widths[i] / 2, (random() - .5) * fontSize * .1);
          context.rotate((random() - .5) * .09);
          context.scale(.97 + random() * .06, .96 + random() * .08);
          context.globalAlpha = .82 + random() * .18;
          context.fillText(glyph, 0, 0);
          context.restore();
          x += widths[i];
        });
        context.restore();
      });
      context.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < canvas.width * canvas.height / 60; i++) {
        context.globalAlpha = .3 + random() * .6;
        context.fillRect(random() * canvas.width, random() * canvas.height, 1 + random() * 13, .5 + random() * 3);
      }
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      material.map = new THREE.CanvasTexture(canvas);
      material.map.colorSpace = THREE.SRGBColorSpace;
    }
    const slogan = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material);
    slogan.position.set(spec.x, 4.7, spec.z ?? 20.43);
    slogan.rotation.y = spec.rotation ?? 0;
    slogan.userData.nanjingFeature = 'wall-slogan'; slogan.userData.text = spec.text;
    slogan.visible = Boolean(material.map);
    scene.add(slogan);
  }
  const barbicans = [];
  for (const side of [-1, 1]) {
    const x = side * (GATE_WIDTH / 2 - NANJING_RAMPART_THICKNESS / 2);
    const curtainHeight = WALL_WALK.height - .4;
    for (const piece of subtractCasemateBox({ minX: x - NANJING_RAMPART_THICKNESS / 2,
      maxX: x + NANJING_RAMPART_THICKNESS / 2, minY: 0, maxY: curtainHeight,
      minZ: NANJING_GATE_NORTH_EDGE, maxZ: NANJING_GATE_SOUTH_EDGE })) {
      obstacles.push({ minX: piece.minX, maxX: piece.maxX, minZ: piece.minZ, maxZ: piece.maxZ,
        minY: piece.minY, height: piece.maxY });
    }
    let startZ = NANJING_GATE_NORTH_EDGE;
    for (const gate of [...gateways, { z: NANJING_GATE_SOUTH_EDGE, depth: 0 }]) {
      const endZ = gate.z - gate.depth / 2;
      if (endZ > startZ) {
        for (const piece of subtractCasemateBox({ minX: x - NANJING_RAMPART_THICKNESS / 2,
          maxX: x + NANJING_RAMPART_THICKNESS / 2, minY: 0, maxY: curtainHeight,
          minZ: startZ, maxZ: endZ })) {
          const curtain = addBox((piece.minX + piece.maxX) / 2, (piece.minY + piece.maxY) / 2,
            (piece.minZ + piece.maxZ) / 2, piece.maxX - piece.minX, piece.maxY - piece.minY,
            piece.maxZ - piece.minZ, warmBrick, false, true);
          curtain.userData.nanjingFeature = 'barbican-curtain-wall';
        }
        const walk = addBox(x, WALL_WALK.height - .225 * DETAIL_SCALE, (startZ + endZ) / 2,
          NANJING_RAMPART_THICKNESS, .45 * DETAIL_SCALE, endZ - startZ, brick);
        walk.userData.nanjingFeature = 'wall-walk';
      }
      startZ = gate.z + gate.depth / 2;
    }
    const cityWall = NANJING_CITY_WALLS.find(wall => side < 0
      ? wall.maxX === -GATE_WIDTH / 2 : wall.minX === GATE_WIDTH / 2);
    for (const [min, max] of [[NANJING_GATE_NORTH_EDGE, cityWall.minZ + .3],
      [cityWall.maxZ - .3, NANJING_GATE_SOUTH_EDGE]])
      makeParapet('z', min, max, side * (GATE_WIDTH / 2 - .3), WALL_WALK.height, { height: 1.5 });
    const walk = NANJING_WALL_WALKS.find(candidate => Math.sign(candidate.minX) === side);
    makeParapet('x', Math.max(-GATE_WIDTH / 2, walk.minX),
      Math.min(GATE_WIDTH / 2, walk.maxX), NANJING_GATE_SOUTH_EDGE - .3, WALL_WALK.height, { height: 1.5 });
    for (const z of [-18, -6, 6, 18].map(value => value * DETAIL_SCALE)) {
      if (z < NANJING_GATE_NORTH_EDGE || z > NANJING_GATE_SOUTH_EDGE) continue;
      const niche = addBox(x - Math.sign(x) * .8 * DETAIL_SCALE,
        2 * DETAIL_SCALE, z, .08 * DETAIL_SCALE, 1.4 * DETAIL_SCALE, 1.5 * DETAIL_SCALE, dark);
      niche.userData.nanjingFeature = 'wall-arch-niche';
    }
  }
  for (const courtyard of NANJING_COURTYARDS) {
    const deck = makeSurface(0, courtyard.centerZ, courtyard.width, courtyard.depth,
      courtyardGround, -.12 * DETAIL_SCALE);
    deck.userData.nanjingFeature = `barbican-courtyard-${courtyard.index}`;
    barbicans.push({ ...courtyard });
  }
  const flankingStructures = [];
  const flankTop = WALL_WALK.height;
  for (const buffer of NANJING_FLANKING_BUFFERS) {
    for (const courtyard of NANJING_COURTYARDS) {
      const mainCave = buffer.side > 0 && courtyard.index === 1 ? NANJING_SOLDIER_CAVE : null;
      const caves = mainCave ? [] : NANJING_SOLDIER_CAVES.filter(soldierCave =>
        soldierCave.level === 'ramp' && soldierCave.side === buffer.side &&
        soldierCave.z >= courtyard.minZ && soldierCave.z <= courtyard.maxZ);
      const ramp = NANJING_WALL_RAMPS.find(wallRamp => wallRamp.side === buffer.side &&
        wallRamp.centerZ >= courtyard.minZ && wallRamp.centerZ <= courtyard.maxZ);
      const openings = [
        ...caves.map(soldierCave => ({
          kind: 'cave',
          z: soldierCave.z,
          depth: Math.max(1.25, soldierCave.width + .35),
          bottom: soldierCave.y - soldierCave.height / 2,
          top: soldierCave.y + soldierCave.height / 2,
        })),
        ...(mainCave ? [{
          kind: 'main-cave',
          z: mainCave.z,
          depth: mainCave.depth,
          bottom: 0,
          top: mainCave.floorHeight + mainCave.roomHeight + .18,
        }] : []),
        ...(ramp ? [{ kind: 'ramp', z: ramp.centerZ, depth: ramp.width,
          bottom: 0, top: flankTop }] : []),
      ].map(opening => ({
        ...opening,
        minZ: Math.max(courtyard.minZ, opening.z - opening.depth / 2),
        maxZ: Math.min(courtyard.maxZ, opening.z + opening.depth / 2),
      })).sort((a, b) => a.minZ - b.minZ);

      const addMasonry = (z, depth, bottom, top) => {
        const height = top - bottom;
        if (depth <= .01 || height <= .01) return;
        for (const piece of subtractCasemateBox({ minX: buffer.minX, maxX: buffer.maxX,
          minZ: z - depth / 2, maxZ: z + depth / 2, minY: bottom, maxY: top })) {
          const block = addBox((piece.minX + piece.maxX) / 2, (piece.minY + piece.maxY) / 2,
            (piece.minZ + piece.maxZ) / 2, piece.maxX - piece.minX, piece.maxY - piece.minY,
            piece.maxZ - piece.minZ, brick, true, true);
          block.userData.nanjingFeature = 'flanking-masonry-core';
          if (piece.maxY === NANJING_CASEMATE.floorY) obstacles.at(-1).walkable = true;
        }
        if (top === flankTop) {
          flankWalkSupports.push({ minX: buffer.minX, maxX: buffer.maxX,
            minZ: z - depth / 2, maxZ: z + depth / 2, height: top });
        }
      };

      let cursorZ = courtyard.minZ;
      for (const opening of openings) {
        if (opening.minZ > cursorZ) {
          addMasonry((cursorZ + opening.minZ) / 2, opening.minZ - cursorZ, 0, flankTop);
        }
        if (opening.kind !== 'ramp') {
          addMasonry((opening.minZ + opening.maxZ) / 2, opening.maxZ - opening.minZ, 0, opening.bottom);
          addMasonry((opening.minZ + opening.maxZ) / 2, opening.maxZ - opening.minZ, opening.top, flankTop);
          if (opening.kind === 'main-cave') {
            const rearStart = mainCave.x + mainCave.width / 2 + .1;
            const rearWidth = buffer.maxX - rearStart;
            if (rearWidth > .01) {
              const rear = addBox(rearStart + rearWidth / 2, opening.top / 2, opening.z,
                rearWidth, opening.top, opening.depth, brick, true, true);
              rear.userData.nanjingFeature = 'flanking-masonry-core';
            }
          } else {
            const backX = buffer.side > 0 ? buffer.maxX - .09 : buffer.minX + .09;
            const back = addBox(backX, (opening.bottom + opening.top) / 2,
              (opening.minZ + opening.maxZ) / 2, .18, opening.top - opening.bottom,
              opening.maxZ - opening.minZ, brick, true, true);
            back.userData.nanjingFeature = 'flanking-cave-back';
          }
        } else {
          for (const edge of [-1, 1]) {
            const sideWall = addBox(buffer.centerX, flankTop / 2, opening.z + edge * (opening.depth / 2 - .09),
              buffer.width, flankTop, .18, brick, true, true);
            sideWall.userData.nanjingFeature = 'flanking-ramp-cheek';
            flankWalkSupports.push({ minX: buffer.minX, maxX: buffer.maxX,
              minZ: sideWall.position.z - .09, maxZ: sideWall.position.z + .09, height: flankTop });
          }
        }
        cursorZ = Math.max(cursorZ, opening.maxZ);
      }
      if (cursorZ < courtyard.maxZ) {
        addMasonry((cursorZ + courtyard.maxZ) / 2, courtyard.maxZ - cursorZ, 0, flankTop);
      }
      flankingStructures.push({
        side: buffer.side,
        courtyardId: courtyard.id,
        minX: buffer.minX,
        maxX: buffer.maxX,
        minZ: courtyard.minZ,
        maxZ: courtyard.maxZ,
        openings: openings.map(({ kind, z, minZ, maxZ, bottom, top }) =>
          ({ kind, z, minZ, maxZ, bottom, top })),
      });
    }
  }
  for (const ramp of NANJING_WALL_RAMPS) {
    const treadCount = Math.ceil(ramp.height / .15);
    for (let step = 0; step < treadCount; step++) {
      const progress = (step + .5) / treadCount;
      const x = ramp.side > 0
        ? ramp.minX + progress * ramp.length
        : ramp.maxX - progress * ramp.length;
      const stepHeight = (step + 1) * ramp.height / treadCount;
      const buffer = NANJING_FLANKING_BUFFERS.find(buffer => buffer.side === ramp.side);
      const minX = Math.max(buffer.minX, x - ramp.length / treadCount / 2);
      const maxX = Math.min(buffer.maxX, x + ramp.length / treadCount / 2);
      const tread = addBox((minX + maxX) / 2, stepHeight / 2, ramp.centerZ,
        maxX - minX, stepHeight, ramp.width - .36, stone);
      tread.userData.nanjingFeature = `${ramp.id}-wall-stair-tread`;
    }
  }
  const casemate = NANJING_CASEMATE;
  const roomPlaster = surface('plaster', 0xc8c0ad, 1.4);
  const roomBox = (bounds, material, feature, collision = false, walkable = false) => {
    const mesh = addBox((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY,
      bounds.maxZ - bounds.minZ, material, collision);
    mesh.userData.nanjingFeature = feature;
    if (collision && walkable) obstacles.at(-1).walkable = true;
    return mesh;
  };
  const stepWidth = (casemate.stairs.maxX - casemate.stairs.minX) / casemate.stairs.steps;
  for (let step = 0; step < casemate.stairs.steps; step++) {
    const height = casemate.floorY * (step + 1) / casemate.stairs.steps;
    const bounds = { minX: casemate.stairs.maxX - (step + 1) * stepWidth,
      maxX: casemate.stairs.maxX - step * stepWidth, minZ: casemate.stairs.minZ, maxZ: casemate.stairs.maxZ };
    roomBox({ ...bounds, minY: 0, maxY: height }, stone, 'casemate-stair-tread', true, true);
    roomBox({ ...bounds, minY: height + 2.45, maxY: casemate.ceilingY },
      brick, 'casemate-stair-ceiling', true);
  }
  for (const bounds of [casemate.corridor, casemate.room]) {
    for (const piece of subtractCasemateBox({ ...bounds, minY: casemate.floorY - .2, maxY: casemate.floorY },
      [{ ...casemate.stairs, minY: 0, maxY: casemate.ceilingY }]))
      roomBox(piece, stone, 'casemate-floor', true, true);
    roomBox({ ...bounds, minY: casemate.ceilingY, maxY: casemate.ceilingY + .18 },
      roomPlaster, 'casemate-ceiling', true);
  }
  const room = casemate.room, slit = casemate.slit;
  for (const bounds of [
    { minX: room.minX, maxX: room.minX + .04, minZ: room.minZ, maxZ: room.maxZ },
    { minX: room.maxX - .04, maxX: room.maxX, minZ: room.minZ, maxZ: room.maxZ },
    { minX: room.minX, maxX: casemate.corridor.minX, minZ: room.minZ, maxZ: room.minZ + .04 },
    { minX: casemate.corridor.maxX, maxX: room.maxX, minZ: room.minZ, maxZ: room.minZ + .04 },
  ]) roomBox({ ...bounds, minY: casemate.floorY, maxY: casemate.ceilingY }, roomPlaster, 'casemate-plaster');
  for (const bounds of [
    { minX: room.minX, maxX: slit.minX, minY: casemate.floorY, maxY: casemate.ceilingY },
    { minX: slit.maxX, maxX: room.maxX, minY: casemate.floorY, maxY: casemate.ceilingY },
    { minX: slit.minX, maxX: slit.maxX, minY: casemate.floorY, maxY: slit.minY },
    { minX: slit.minX, maxX: slit.maxX, minY: slit.maxY, maxY: casemate.ceilingY },
  ]) roomBox({ ...bounds, minZ: room.maxZ - .04, maxZ: room.maxZ - .005 }, roomPlaster, 'casemate-plaster');
  sceneArt.casemate = { stairs: casemate.stairs.steps, protectedRoom: true, firingSlit: true };
  const cave = NANJING_SOLDIER_CAVE;
  const caveFloor = addBox(cave.x, cave.floorHeight / 2, cave.z, cave.width, cave.floorHeight, cave.depth, stone);
  caveFloor.userData.nanjingFeature = 'soldier-cave-floor';
  const caveBack = addBox(cave.x + cave.width / 2, cave.floorHeight + cave.roomHeight / 2, cave.z,
    .18, cave.roomHeight, cave.depth, dark, true);
  caveBack.userData.nanjingFeature = 'soldier-cave-back-wall';
  for (const side of [-1, 1]) {
    const caveWing = addBox(cave.x, cave.floorHeight + cave.roomHeight / 2,
      cave.z + side * (cave.depth / 2 - .09), cave.width, cave.roomHeight, .18, brick, true);
    caveWing.userData.nanjingFeature = 'soldier-cave-wing';
  }
  const caveRoof = addBox(cave.x, cave.floorHeight + cave.roomHeight + .09,
    cave.z, cave.width, .18, cave.depth, stone, true);
  caveRoof.userData.nanjingFeature = 'soldier-cave-roof';
  for (const side of [-1, 1]) {
    const jamb = addBox(cave.x - cave.width / 2, cave.floorHeight + cave.roomHeight / 2,
      cave.z + side * (cave.depth / 2 - .09), .18, cave.roomHeight, .18, stone);
    jamb.userData.nanjingFeature = 'soldier-cave-entrance-frame';
  }
  const caveLintel = addBox(cave.x - cave.width / 2, cave.floorHeight + cave.roomHeight,
    cave.z, .18, .18, cave.depth, stone);
  caveLintel.userData.nanjingFeature = 'soldier-cave-entrance-frame';
  for (const soldierCave of NANJING_SOLDIER_CAVES) {
    if (soldierCave.level === 'ramp' && soldierCave.side > 0 &&
      soldierCave.z >= cave.z - cave.depth / 2 && soldierCave.z <= cave.z + cave.depth / 2) continue;
    const northSouth = soldierCave.face === 'north' || soldierCave.face === 'south';
    const faceOffset = soldierCave.face === 'south' || soldierCave.face === 'east' ? .06 : -.06;
    const faceX = northSouth ? soldierCave.x : soldierCave.x + faceOffset;
    const faceZ = northSouth ? soldierCave.z + faceOffset : soldierCave.z;
    const panel = addBox(faceX, soldierCave.y, faceZ,
      northSouth ? soldierCave.width : .1, soldierCave.height,
      northSouth ? .1 : soldierCave.width, dark);
    panel.userData.nanjingFeature = 'soldier-cave-opening';
    const jambOffset = soldierCave.width / 2 + .08;
    for (const side of [-1, 1]) {
      const jamb = addBox(northSouth ? faceX + side * jambOffset : faceX,
        soldierCave.y, northSouth ? faceZ : faceZ + side * jambOffset,
        northSouth ? .14 : .12, soldierCave.height + .14,
        northSouth ? .12 : .14, stone);
      jamb.userData.nanjingFeature = 'soldier-cave-frame';
    }
    const lintel = addBox(faceX, soldierCave.y + soldierCave.height / 2 + .08, faceZ,
      northSouth ? soldierCave.width + .3 : .12, .14,
      northSouth ? .12 : soldierCave.width + .3, stone);
    lintel.userData.nanjingFeature = 'soldier-cave-frame';
  }
  const bridges = [
    makeStoneBridge(YUHUA_BRIDGE.x, YUHUA_BRIDGE.z, YUHUA_BRIDGE.width, 44),
  ];
  const roofMaterial = surface('tiles', 0x89918c, 1.4);
  roofMaterial.side = THREE.DoubleSide;
  const distantHouse = (x, z, width, depth, height, material) => {
    const house = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    house.position.set(x, height / 2, z);
    house.userData.nanjingFeature = 'north-distant-house';
    const roof = new THREE.Mesh(createRoofGeometry(width + .7, depth + .6, .9, 1.4), roofMaterial);
    roof.position.set(x, height, z);
    roof.userData.nanjingFeature = 'north-distant-roof';
    scene.add(house, roof);
  };
  for (let index = 0; index < 24; index++) {
    const x = -83 + index % 8 * 14 + (Math.floor(index / 8) % 2) * 5;
    const z = -132 - Math.floor(index / 8) * 30 - (index % 3) * 3;
    distantHouse(x, z, 5 + index % 3, 4.5, 3.1 + index % 3 * .55, index % 3 ? brick : stone);
  }
  for (let index = 0; index < 18; index++) {
    const x = NANJING_RIVER_SHORE_X + 7 + index % 3 * 12 + Math.sin(index * 3.7) * 2;
    const z = -132 - Math.floor(index / 3) * 24 - (index % 2) * 6;
    distantHouse(x, z, 4.5 + index % 3, 4 + index % 2, 3 + index % 3 * .45,
      index % 3 ? brick : stone);
  }
  for (let row = 0; row < 2; row++) for (let index = 0; index < 20; index++) {
    const x = -67 + index * 8.5 + (row ? 1.5 : 0) + Math.sin(index * 2.71) * .5;
    const z = -101.5 - row * 6 + Math.cos(index * 1.73) * .35;
    const width = 5.3 + (index % 4) * .5, depth = 4;
    if (cityLayout.lots.some(([houseX, houseZ, houseWidth, houseDepth]) =>
      Math.abs(houseX - x) < (houseWidth + width) / 2 + .8 &&
      Math.abs(houseZ - z) < (houseDepth + depth) / 2 + .8)) continue;
    const height = 3.2 + row * 1.4 + (index % 3) * .65;
    const start = solids.length;
    const body = addBox(x, height / 2, z, width, height, depth, index % 3 ? brick : stone);
    body.userData.nanjingFeature = 'northern-background-house';
    const roof = new THREE.Mesh(createRoofGeometry(width + .7, depth + .6, .9, 1.4), roofMaterial);
    roof.position.set(x, height, z); roof.castShadow = roof.receiveShadow = true;
    roof.userData.nanjingFeature = 'northern-background-roof';
    scene.add(roof); solids.push(roof);
    for (const side of [-1, 1]) addBox(x + side * width * .27, 1.6, z + depth / 2 + .02, .7, .85, .045, dark);
    addBox(x, 1.05, z + depth / 2 + .03, .9, 2.1, .06, timber);
    for (const mesh of solids.slice(start)) {
      mesh.userData.staticResidential = true; residentialMeshes.push(mesh);
    }
    northernBackdrop.push({ x, z, width, depth, height, interactive: false });
  }
  const residentialLots = cityLayout.lots;
  const plaster = surface('plaster', 0xaaa18b, 1.2);
  const templeLot = residentialLots.map((lot, index) => ({ lot, index }))
    .filter(({ lot }) => lot[4] > 1 && lot[0] > -51 && lot[0] < -24 && lot[1] > -68 && lot[1] < -28 && lot[2] > 5 && lot[3] > 5)
    .sort((a, b) => (a.lot[0] + 38) ** 2 + (a.lot[1] + 47) ** 2 - (b.lot[0] + 38) ** 2 - (b.lot[1] + 47) ** 2)[0];
  if (!templeLot) throw new Error('No existing roadside parcel is available for the small temple');
  const templeRed = new THREE.MeshStandardMaterial({ color: 0x62382c, roughness: .95 });
  const templeBronze = new THREE.MeshStandardMaterial({ color: 0x887344, roughness: .78, metalness: .25 });
  for (const [index, [x, z, footprintWidth, footprintDepth, sourceFloors, facing]] of residentialLots.entries()) {
    const temple = index === templeLot.index, floors = temple ? 1 : sourceFloors;
    const w = facing % 2 ? footprintDepth : footprintWidth;
    const d = facing % 2 ? footprintWidth : footprintDepth;
    const firstSolid = solids.length, firstObstacle = obstacles.length, firstImpact = impactGeometry.length;
    const h = floors * 2.7;
    const damaged = !temple && z < 10 && (index % 3 !== 0 || z >= -26 && index % 4 === 0);
    const facade = index % 3 === 0 ? brick : plaster;
    const doorWidth = 1.3, doorHeight = 2.2, thickness = .24;
    const wall = (px, py, pz, width, height, depth) => {
      const mesh = addBox(px, py, pz, width, height, depth, facade, true);
      mesh.userData.nanjingFeature = 'residential-house';
      mesh.userData.floors = floors;
      mesh.geometry = boxGeometry.clone();
      const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
      const uv = mesh.geometry.attributes.uv, meters = facade.userData.metersPerTile ?? 2.4;
      for (let vertex = 0; vertex < uv.count; vertex++) {
        uv.setXY(vertex, (Math.abs(normals.getX(vertex)) > .5 ? positions.getZ(vertex) * depth : positions.getX(vertex) * width) / meters,
          (Math.abs(normals.getY(vertex)) > .5 ? positions.getZ(vertex) * depth : positions.getY(vertex) * height) / meters);
      }
      return mesh;
    };
    const frontZ = z - d / 2;
    for (const side of [-1, 1]) {
      const wallHeight = damaged && side > 0 ? 1.05 : h;
      wall(x + side * (w / 2 - thickness / 2), wallHeight / 2, z, thickness, wallHeight, d);
      wall(x + side * (w + doorWidth) / 4, wallHeight / 2, frontZ,
        (w - doorWidth) / 2, wallHeight, thickness);
    }
    wall(x, (h + doorHeight) / 2, frontZ, doorWidth, h - doorHeight, thickness);
    wall(x, h / 2, z + d / 2 - thickness / 2, w - thickness * 2, h, thickness);
    addBox(x, -.06, z, w - thickness * 2, .12, d - thickness * 2, timber);
    const intactWidth = damaged ? w * .5 : w;
    const roofX = damaged ? x - w * .25 : x;
    addBox(roofX, 2.6, z, intactWidth - thickness * 2, .2, d - thickness * 2, timber, true);
    town.passages.push({ id: `nanjing-home-${index}-door`, x, z: frontZ,
      axis: 'x', width: doorWidth, height: doorHeight + .05, openAngle: 0 });
    const roofRise = .85, overhang = .3;
    const roofGeometry = createResidentialRoofGeometry(w + overhang * 2, d + .8, roofRise,
      roofMaterial.userData.metersPerTile ?? 1.4, damaged, index);
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.set(x, h, z);
    roof.castShadow = roof.receiveShadow = true;
    roof.userData.nanjingFeature = 'residential-tile-roof';
    roof.userData.roofStyle = 'taierzhuang-curved-tiles';
    roof.userData.damaged = damaged;
    scene.add(roof); solids.push(roof);
    addBox(x, h + roofRise + .06, damaged ? z + d * .38 : z,
      .24, .18, damaged ? d * .2 : d + .9, roofMaterial);
    for (const side of [-1, 1]) {
      addBox(x + side * (w + doorWidth) / 4, .18, frontZ, (w - doorWidth) / 2, .36, .34, brick);
      addBox(x + side * (w / 2 - .1), .18, z, .3, .36, d, brick);
    }
    addBox(x, .18, z + d / 2 - .1, w, .36, .3, brick);
    // Ruins retain supported end gables, not a solid block filling the exposed attic.
    const gable = new THREE.Shape();
    gable.moveTo(-intactWidth / 2, 0);
    gable.lineTo(damaged ? intactWidth / 2 : 0, roofRise);
    gable.lineTo(intactWidth / 2, 0);
    gable.closePath();
    const gableDepth = damaged ? thickness : d;
    for (const gableZ of damaged ? [z - d / 2, z + d / 2 - thickness] : [z - d / 2]) {
      const roofCore = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: gableDepth, bevelEnabled: false }), facade);
      roofCore.userData.nanjingFeature = 'residential-roof-core';
      roofCore.position.set(roofX, h, gableZ);
      roofCore.castShadow = roofCore.receiveShadow = true;
      scene.add(roofCore); solids.push(roofCore);
      obstacles.push({ minX: roofX - intactWidth / 2, maxX: roofX + intactWidth / 2,
        minZ: gableZ, maxZ: gableZ + gableDepth, minY: h, height: h + roofRise });
    }
    for (const side of [-1, 1]) {
      addBox(x + side * (doorWidth / 2 + .06), doorHeight / 2, frontZ - .08, .12, doorHeight, .16, timber);
      if (!damaged || side < 0) addBox(x + side * (w / 2 + .05), h + .1, z, .14, .2, d + .8, timber);
    }
    addBox(x, doorHeight + .08, frontZ - .08, doorWidth + .24, .16, .16, timber);
    addBox(x, .07, z - d / 2 - .24, 1.4, .14, .4, stone);
    for (let floor = 0; floor < floors; floor++) {
      for (const side of [-1, 1]) for (const face of [-1, 1]) {
        if (damaged && side > 0 && (face < 0 || floor > 0)) continue;
        const window = addBox(x + side * w * .3, 1.65 + floor * 2.7,
          z + face * (d / 2 + .06), .9, 1, .1, dark);
        window.userData.nanjingFeature = 'residential-window';
        for (const edge of [-1, 1]) {
          addBox(window.position.x + edge * .49, window.position.y, window.position.z,
            .08, 1.12, .14, timber);
        }
        addBox(window.position.x, window.position.y, window.position.z + face * .06, .055, 1, .08, timber);
        addBox(window.position.x, window.position.y + .54, window.position.z, 1.06, .08, .14, timber);
        addBox(x + side * w * .3, 1.13 + floor * 2.7,
          z + face * (d / 2 + .1), 1.05, .1, .2, stone);
      }
      if (floor > 0) addBox(roofX, floor * 2.7, z, intactWidth + .08, .12, d + .08, stone);
    }
    residentialBuildings.push({ id: `nanjing-home-${index}`, x, z, width: w, depth: d,
      floors, height: h + roofRise, exit: { x, z: z - d / 2 - .8 },
      damaged, use: temple ? 'temple' : z < -30 && index % 2 === 0 && !damaged ? 'shop' : 'home' });
    if (temple) {
      for (const side of [-1, 1]) {
        addBox(x + side * (w / 2 - .45), 1.32, frontZ - .26, .19, 2.64, .19, templeRed, true);
        addBox(x + side * (w / 2 - .45), .13, frontZ - .26, .33, .26, .33, stone, true);
      }
      addBox(x, 2.52, frontZ - .25, w - .5, .18, .24, templeRed);
      makePlaque('佛堂', x, 2.40, frontZ - .42, 1.5, .35, false, -1);
      const altarZ = z + d / 2 - 1.05;
      addBox(x, .38, altarZ, 1.4, .76, 1.05, stone, true);
      addBox(x, .78, altarZ, 1.55, .1, 1.15, templeRed, true);
      for (const [px, py, pz, sx, sy, sz] of [
        [0, 1, 0, .48, .17, .30], [0, 1.38, .08, .27, .38, .20],
        [0, 1.88, .04, .16, .19, .16], [0, 2.07, .06, .085, .075, .085],
        [-.16, 1.86, .02, .035, .10, .045], [.16, 1.86, .02, .035, .10, .045],
        [0, 1.88, -.13, .025, .035, .025],
        [-.31, 1.35, -.02, .08, .28, .09], [.31, 1.35, -.02, .08, .28, .09],
        [0, 1.14, -.22, .17, .055, .09],
      ]) {
        const part = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), templeBronze);
        part.position.set(x + px, py, altarZ + pz); part.scale.set(sx, sy, sz);
        part.receiveShadow = true; part.userData.nanjingFeature = 'temple-buddha'; scene.add(part); solids.push(part);
      }
      for (const side of [-1, 1]) addBox(x + side * .058, 1.925, altarZ - .11, .047, .007, .01, dark);
      addBox(x, 1.82, altarZ - .11, .055, .007, .01, dark);
      obstacles.push({ minX: x - .72, maxX: x + .72, minZ: altarZ - .6, maxZ: altarZ + .6, height: 2.2 });
      const bell = new THREE.Mesh(new THREE.LatheGeometry([
        new THREE.Vector2(.03, .4), new THREE.Vector2(.12, .32), new THREE.Vector2(.16, .08), new THREE.Vector2(.22, 0),
      ], 12), templeBronze);
      bell.position.set(x - w / 2 + .75, 1.75, frontZ - .20);
      bell.receiveShadow = true;
      bell.userData.nanjingFeature = 'temple-bell'; scene.add(bell); solids.push(bell);
      addBox(bell.position.x, 2.35, bell.position.z, .035, .4, .035, templeBronze);
      addBox(x, h + roofRise + .05, z, .18, .18, d + .6, roofMaterial);
      addBox(x + w / 2 - .8, .25, frontZ + .6, .45, .5, .45, stone, true);
      const censer = new THREE.Mesh(new THREE.CylinderGeometry(.23, .17, .18, 12), templeBronze);
      censer.position.set(x + w / 2 - .8, .59, frontZ + .6);
      censer.userData.nanjingFeature = 'temple-censer'; scene.add(censer); solids.push(censer);
      for (let stick = -1; stick <= 1; stick++)
        addBox(censer.position.x + stick * .06, .83, censer.position.z, .012, .36, .012, templeRed);
    }
    if (index % 3 === 0 || damaged) for (let mark = 0; mark < 7; mark++) {
      const spread = Math.sin((index * 7 + mark * 13) * 2.37);
      const remainingHeight = damaged && spread >= 0 ? 1.05 : h;
      shellPocks(x + (spread >= 0 ? 1 : -1) * (doorWidth / 2 + .4 + Math.abs(spread) * (w / 2 - doorWidth / 2 - .8)),
        .35 + (Math.sin(mark * 8.31 + index) + 1) / 2 * Math.min(3, remainingHeight - .7),
        frontZ - thickness / 2, damaged ? .16 : .065, index + mark);
    }
    if (damaged) {
      for (let piece = 0; piece < 14; piece++) {
        const rubble = addBox(x + .65 + piece % 3 * .52, .12 + piece % 2 * .12,
          z - d / 2 + .75 + Math.floor(piece / 3) * .75,
          .32 + piece % 3 * .12, .23, .42, piece % 3 ? brick : roofMaterial, true);
        rubble.rotation.set(.1 * (piece % 3), piece * .83, .12);
        rubble.userData.nanjingFeature = 'collapsed-house-rubble';
      }
      for (let rafter = 0; rafter < 5; rafter++) {
        const startX = x - w / 2 + .1, endX = x - w * (.06 + rafter % 3 * .03);
        const startY = h - .04, endY = h - .3 - rafter % 3 * .16;
        const beam = addBox((startX + endX) / 2, (startY + endY) / 2,
          z - d * .36 + rafter * d * .18, Math.hypot(endX - startX, endY - startY), .14, .16, timber);
        beam.rotation.z = Math.atan2(endY - startY, endX - startX);
        beam.userData.nanjingFeature = 'broken-roof-beam';
      }
    }
    if (!temple && z < -30 && index % 2 === 0 && !damaged) {
      const awning = addBox(x, 2.45, frontZ - .65, w - .7, .12, 1.15, timber);
      awning.rotation.x = .12;
      awning.userData.nanjingFeature = 'residential-shop-awning';
      for (const side of [-1, 1]) {
        const stall = addBox(x + side * (w / 2 - 1), .42, frontZ - .45,
          .75, .84, .55, timber, true);
        stall.userData.nanjingFeature = 'residential-shop-stall';
      }
    }
    const home = residentialBuildings.at(-1), passage = town.passages.at(-1);
    if (z === 75 && !damaged && facing === 0)
      openingHouseCovers.set(home.id, obstacles.slice(firstObstacle, firstObstacle + 7));
    home.width = footprintWidth; home.depth = footprintDepth;
    home.facing = facing;
    if (facing) {
      const cosine = [1, 0, -1, 0][facing], sine = [0, 1, 0, -1][facing];
      const transform = (px, pz) => ({ x: x + (px - x) * cosine + (pz - z) * sine,
        z: z - (px - x) * sine + (pz - z) * cosine });
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing * Math.PI / 2);
      for (const mesh of solids.slice(firstSolid)) {
        const point = transform(mesh.position.x, mesh.position.z);
        mesh.position.set(point.x, mesh.position.y, point.z);
        mesh.quaternion.premultiply(rotation);
      }
      for (const obstacle of obstacles.slice(firstObstacle)) {
        const a = transform(obstacle.minX, obstacle.minZ), b = transform(obstacle.maxX, obstacle.maxZ);
        Object.assign(obstacle, { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
          minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
      }
      const matrix = new THREE.Matrix4().makeTranslation(x, 0, z)
        .multiply(new THREE.Matrix4().makeRotationY(facing * Math.PI / 2))
        .multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z));
      for (const geometry of impactGeometry.slice(firstImpact)) geometry.applyMatrix4(matrix);
      Object.assign(passage, transform(passage.x, passage.z), { axis: facing % 2 ? 'z' : 'x' });
      home.exit = transform(home.exit.x, home.exit.z);
    }
    if (temple) {
      passage.openAngle = -Math.PI / 2;
      templeLandmark = { id: home.id, x, z, width: footprintWidth, depth: footprintDepth,
        facing, entry: { ...home.exit }, fictional: true, sourceParcelFloors: sourceFloors };
    }
    for (const mesh of solids.slice(firstSolid)) {
      mesh.userData.residentialId = home.id;
      if (mesh.visible && !mesh.material.transparent) {
        mesh.userData.staticResidential = true;
        residentialMeshes.push(mesh);
      }
    }
  }

  for (const [x, z, count, angle] of [[-8, 13, 15, Math.PI / 2], [10, 4, 10, Math.PI / 2], [-8, -4, 10, Math.PI / 2]]) {
    for (let index = 0; index < count; index++) {
      const row = Math.floor(index / 5), column = index % 5;
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .58, 3, 7), burlap);
      bag.position.set(x + (column - 2) * .45 * Math.cos(angle), .34 + row * .35,
        z - (column - 2) * .45 * Math.sin(angle));
      bag.rotation.z = Math.PI / 2;
      bag.rotation.y = angle;
      bag.castShadow = bag.receiveShadow = true;
      scene.add(bag);
      solids.push(bag);
      obstacles.push({ minX: bag.position.x - .5, maxX: bag.position.x + .5,
        minZ: bag.position.z - .5, maxZ: bag.position.z + .5, height: bag.position.y + .5 });
      town.covers.push({ id: `sandbag-${x}-${z}-${index}`, x: bag.position.x, z: bag.position.z, kind: 'low' });
    }
  }
  const forwardDefenses = [];
  function placeForwardSandbag(x, z, row, id, yaw = 0, feature = 'forward-sandbag', floor = 0) {
    let seed = 2166136261;
    for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const variation = shift => ((seed >>> shift) & 31) / 31 - .5;
    const visual = new THREE.Mesh(detailedSandbagGeometry, burlap);
    visual.position.set(x + variation(0) * .07, floor + .21 + row * .36 + variation(5) * .035,
      z + variation(10) * .07);
    visual.scale.set(.59 * (1 + variation(15) * .045), .23 * (1 + variation(20) * .1),
      .44 * (1 + variation(25) * .06));
    visual.rotation.set(variation(5) * .035, yaw + variation(10) * .09, variation(15) * .04);
    visual.userData.nanjingFeature = feature;
    visual.userData.sandbagStyle = 'taierzhuang-detailed';
    visual.castShadow = visual.receiveShadow = true;
    scene.add(visual);
    const collision = sandbagCollisionProxy(visual, collisionSandbagGeometry);
    collision.userData.nanjingFeature = `${feature}-collision`;
    collision.userData.sandbagId = id;
    scene.add(collision);
    solids.push(collision);
    collision.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(collision);
    obstacles.push({ minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z,
      minY: floor, height: bounds.max.y });
  }
  function addForwardDefense(centerX, z, label, count = 10, armBags = 4, yaw = 0, defenses = forwardDefenses,
    feature = defenses === forwardDefenses ? 'forward-sandbag' : 'dock-sandbag') {
    const spacing = .88;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const point = (x, along) => ({ x: centerX + x * c + along * s, z: z - x * s + along * c });
    const place = (x, along, row, id) => {
      const position = point(x, along);
      placeForwardSandbag(position.x, position.z, row, id, yaw, feature);
    };
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < count; column++) {
        place((column - (count - 1) / 2) * spacing + (row % 2 ? .22 : 0),
          0, row, `${label}-front-${row}-${column}`);
      }
      for (const side of [-1, 1]) for (let column = 1; column <= armBags; column++) {
        place(side * (count - 1) * spacing / 2,
          -column * .72, row, `${label}-arm-${side}-${row}-${column}`);
      }
    }
    for (let column = count < 6 ? 1 : 2; column <= count - (count < 6 ? 2 : 3); column += 3) {
      town.covers.push({ id: `forward-defense-${label}-${column}`,
        ...point((column - (count - 1) / 2) * spacing, -1.05), kind: 'low' });
    }
    defenses.push({ id: label, x: centerX, z, width: (count - 1) * spacing + 1.18,
      depth: armBags * .72 + .88, height: 1.16, ...(yaw ? { yaw } : {}) });
  }
  for (const centerX of [-10, 2, 14, 26]) {
    addForwardDefense(centerX, centerX === -10 ? 34 : 35.3, `gate-${centerX}`, 10, centerX === -10 ? 2 : 4);
  }
  // Two bridge-side bays leave the central tank lane open while covering both shoulders.
  addForwardDefense(-35, 37, 'bridge-west', 8, 3);
  addForwardDefense(-13, 37, 'bridge-east', 8, 3);
  const bridgeDeckDefenses = [];
  const gateInteriorDefenses = [];
  const interiorCourt = NANJING_COURTYARDS[0];
  for (const offset of [2.15, -1.3]) for (const side of [-1, 1]) {
    addForwardDefense(side * 5.4, interiorCourt.centerZ + offset,
      `interior-${interiorCourt.id}-${offset > 0 ? 'south' : 'north'}-${side < 0 ? 'west' : 'east'}`,
      4, 0, 0, gateInteriorDefenses, 'gate-interior-sandbag');
  }
  const dockDefenses = [];
  const cityRoadblocks = [];
  addForwardDefense(-84, -55, 'west-gate-roadside', 3, 1, 0, cityRoadblocks, 'city-roadblock');
  addForwardDefense(35, -60, 'city-market-west', 3, 1, 0, cityRoadblocks, 'city-roadblock');
  addForwardDefense(55, -63, 'city-market-east', 3, 1, 0, cityRoadblocks, 'city-roadblock');
  addForwardDefense(-66.5, -92, 'dock-original-north', 5, 2, Math.PI, dockDefenses);
  addForwardDefense(-65, -68, 'dock-original-south', 5, 2, 0, dockDefenses);
  addForwardDefense(-54, -85, 'dock-east-north', 4, 2, Math.PI / 2, dockDefenses);
  addForwardDefense(-54, -74, 'dock-east-south', 4, 2, Math.PI / 2, dockDefenses);
  addForwardDefense(-63, NANJING_WEST_GATE_Z - 6, 'west-gate-north', 4, 1, Math.PI / 2, dockDefenses);
  addForwardDefense(-58.5, NANJING_WEST_GATE_Z + 6, 'west-gate-south', 4, 1, Math.PI / 2, dockDefenses);
  for (const [label, z] of [['north', -89.4], ['south', -70.6]]) {
    for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
      placeForwardSandbag(-92 + NANJING_DOCK_WEST_EXTENSION + (column - 1.5) * .55 + (row % 2 ? .12 : 0), z, row,
        `dock-platform-${label}-${row}-${column}`, 0, 'dock-platform-sandbag');
    }
    town.covers.push({ id: `dock-platform-${label}`, x: -92 + NANJING_DOCK_WEST_EXTENSION, z: z + (label === 'north' ? 1 : -1), kind: 'low' });
    dockDefenses.push({ id: `dock-platform-${label}`, x: -92 + NANJING_DOCK_WEST_EXTENSION, z, width: 2.83, depth: .88, height: 1.16 });
  }
  const dockTimber = surface('timber', 0xc3b29a, 2);
  const aaDeckGeometry = new THREE.BufferGeometry();
  const aaDeckPositions = [], aaDeckUVs = [], aaDeckIndices = [];
  for (let row = 0; row < 5; row++) for (let column = 0; column < 5; column++) {
    const x = -69.8 + column * .9, z = -72.8 + row * .9;
    aaDeckPositions.push(x, aaPlatformHeight(x, z), z);
    aaDeckUVs.push(x / 2, z / 2);
    if (row < 4 && column < 4) {
      const i = row * 5 + column;
      aaDeckIndices.push(i, i + 5, i + 1, i + 1, i + 5, i + 6);
    }
  }
  aaDeckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(aaDeckPositions, 3));
  aaDeckGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(aaDeckUVs, 2));
  aaDeckGeometry.setIndex(aaDeckIndices);
  aaDeckGeometry.computeVertexNormals();
  const aaDeck = new THREE.Mesh(aaDeckGeometry, dockTimber);
  aaDeck.userData.nanjingFeature = 'dock-aa-platform';
  aaDeck.receiveShadow = true;
  scene.add(aaDeck);
  solids.push(aaDeck);
  const dock = addBox(NANJING_DOCK.x, .18, NANJING_DOCK.z, 14, .36, 5, dockTimber);
  dock.receiveShadow = true;
  for (const x of [-6, -3, 0, 3, 6]) for (const z of [-2.2, 2.2]) {
    const pile = addBox(NANJING_DOCK.x + x, -.25, NANJING_DOCK.z + z, .24, 1, .24, dockTimber);
    pile.userData.nanjingFeature = 'dock-pile';
  }
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) for (let column = 0; column < 6; column++) {
      placeForwardSandbag(NANJING_DOCK_ENTRY_X + 1,
        NANJING_DOCK.z + side * (5.5 + column * .88 + (row % 2 ? .18 : 0)), row,
        `dock-outer-${side}-${row}-${column}`, Math.PI / 2, 'dock-outer-sandbag');
    }
  }
  for (const side of [-1, 1]) {
    const gateX = NANJING_DOCK_ENTRY_X, edgeZ = NANJING_DOCK.z + side * 10;
    const returnLength = gateX - NANJING_RIVER_SHORE_X;
    for (const [axis, length, cx, cz, floor] of [
      ['z', 5.5, gateX, NANJING_DOCK.z + side * 7.25, 0],
      ['x', returnLength, NANJING_RIVER_SHORE_X + returnLength / 2, edgeZ, 0],
    ]) {
      const place = (offset, y, width, height, depth, feature, collision = false) => {
        const mesh = addBox(cx + (axis === 'x' ? offset : 0), floor + y,
          cz + (axis === 'z' ? offset : 0), width, height, depth, dockTimber, collision);
        mesh.userData.nanjingFeature = feature;
      };
      const count = Math.ceil(length / 2.5);
      for (let index = 0; index <= count; index++)
        place(-length / 2 + index * length / count, .72, .23, 1.44, .23, 'dock-fence-post', true);
      for (const y of [.48, 1.12])
        place(0, y, axis === 'x' ? length : .18, .17, axis === 'z' ? length : .18, 'dock-fence-rail', true);
      const slats = Math.ceil(length / .75);
      for (let index = 0; index < slats; index++) {
        const height = .84 + (index % 4) * .045;
        place(-length / 2 + (index + .5) * length / slats, .25 + height / 2,
          axis === 'x' ? .12 : .1, height, axis === 'z' ? .12 : .1, 'dock-fence-slat');
      }
    }
  }
  for (const side of [-1, 1]) {
    const post = addBox(NANJING_DOCK_ENTRY_X, 2.2, NANJING_DOCK.z + side * 4.5,
      .34, 4.4, .34, timber, true);
    post.userData.nanjingFeature = 'dock-entry-post';
    const roof = addBox(NANJING_DOCK_ENTRY_X + side * .27, 4.55, NANJING_DOCK.z,
      .65, .12, 10.1, timber);
    roof.rotation.z = -side * .2;
    roof.userData.nanjingFeature = 'dock-entry-roof';
    const endCap = addBox(NANJING_DOCK_ENTRY_X, 4.46, NANJING_DOCK.z + side * 4.9,
      1.28, .18, .24, timber);
    endCap.userData.nanjingFeature = 'dock-entry-roof-end';
  }
  const sign = addBox(NANJING_DOCK_ENTRY_X, 3.9, NANJING_DOCK.z, .24, .9, 9.3, timber, true);
  sign.userData.nanjingFeature = 'dock-entry-sign';
  sign.userData.text = '上新河渡口';
  for (const y of [3.39, 4.41]) {
    const beam = addBox(NANJING_DOCK_ENTRY_X, y, NANJING_DOCK.z, .38, .14, 9.7, timber);
    beam.userData.nanjingFeature = 'dock-entry-beam';
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 192;
    const context = canvas.getContext('2d');
    context.font = '150px KaiTi, STKaiti, FangSong, serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    const angles = [-.025, .015, -.018, .023, -.012];
    const heights = [2, -3, 1, -2, 3];
    for (const [index, character] of [...sign.userData.text].entries()) {
      context.save();
      context.translate(192 + index * 160, 96 + heights[index]);
      context.rotate(angles[index]);
      context.scale(1 + (index % 2 ? -.035 : .025), 1 + (index % 3 - 1) * .025);
      context.lineWidth = 4;
      context.strokeStyle = 'rgba(29, 19, 10, .7)';
      context.strokeText(character, 2, 3);
      context.fillStyle = '#bda879';
      context.fillText(character, 0, 0);
      context.restore();
    }
    context.globalCompositeOperation = 'destination-out';
    for (let index = 0; index < 650; index++) {
      const x = (index * 463 + 37) % canvas.width, y = (index * 97 + (index % 13) * 7) % canvas.height;
      context.globalAlpha = .15 + (index % 5) * .09;
      context.fillRect(x, y, 1 + index % 5, 1 + index % 2);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    for (const side of [-1, 1]) {
      const lettering = new THREE.Mesh(new THREE.PlaneGeometry(4.8, .9),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      lettering.position.set(NANJING_DOCK_ENTRY_X + side * .13, 3.9, NANJING_DOCK.z);
      lettering.rotation.y = side * Math.PI / 2;
      lettering.userData.nanjingFeature = 'dock-entry-lettering';
      scene.add(lettering);
    }
  }
  const dockDetails = createNanjingDockDetails(dockTimber);
  dockDetails.position.set(NANJING_DOCK.x, 0, NANJING_DOCK.z);
  scene.add(dockDetails);
  const rampGeometry = new THREE.BufferGeometry(), rampVertices = [], rampUVs = [], rampIndices = [];
  const rampColumns = 10, rampRows = 15;
  for (let row = 0; row < rampRows; row++) for (let column = 0; column < rampColumns; column++) {
    const x = NANJING_RIVER_SHORE_X + column * .5, z = NANJING_DOCK.z - 3.5 + row * .5;
    rampVertices.push(x, nanjingPierHeight(x, z), z);
    rampUVs.push(z / 2, x / 2);
    if (row && column) {
      const current = row * rampColumns + column;
      rampIndices.push(current - rampColumns - 1, current - 1, current - rampColumns,
        current - 1, current, current - rampColumns);
    }
  }
  rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rampVertices, 3));
  rampGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(rampUVs, 2));
  rampGeometry.setIndex(rampIndices);
  rampGeometry.computeVertexNormals();
  const rampMaterial = dockTimber.clone(); rampMaterial.side = THREE.DoubleSide;
  const dockRamp = new THREE.Mesh(rampGeometry, rampMaterial);
  scene.add(dockRamp); solids.push(dockRamp);
  const civilianCharacters = createCivilianCharacterFactory();
  const makeFerry = createNanjingFerryFactory(dockTimber), ferryRowers = [];
  const reeds = createShoreReeds(solids.filter(mesh => mesh.userData.nanjingFeature === 'river-stone-bank'));
  scene.add(reeds);
  for (let index = 0; index < 5; index++) {
    const boat = makeFerry(), oar = boat.userData.oar;
    const rower = civilianCharacters.create(1000 + index, 'adult', 'man', 'none');
    Object.assign(rower.userData, { ageGroup: 'adult', carrying: 'none', boatman: true });
    rower.position.set(2.35, NANJING_FERRY_FLOOR, .1);
    boat.add(rower); ferryRowers.push(rower);
    const berth = NANJING_FERRY_BERTHS[index];
    boat.position.set(berth.x, .05, berth.z);
    oar.visible = false;
    boat.userData = { ferryId: index, passengers: [], boarding: null, loadedAt: null, oar, rower, state: 'docked',
      originX: berth.x, originZ: berth.z };
    updateNanjingFerryRower(boat, 0);
    const endBerth = index === 4;
    const gangplank = endBerth
      ? addBox(-105.7 + NANJING_DOCK_WEST_EXTENSION, .42, boat.position.z, 1.8, .12, .8, dockTimber)
      : addBox(berth.x, .42, NANJING_DOCK.z + Math.sign(berth.z - NANJING_DOCK.z) * 2.8,
        .8, .12, 1.8, dockTimber);
    gangplank.userData.nanjingFeature = 'ferry-gangplank';
    boat.userData.gangplank = gangplank;
    scene.add(boat);
    ferries.push(boat);
  }

  const civilianHomes = residentialBuildings.filter(house => house.floors === 1 && house.z < 0 && !house.damaged && house.use !== 'temple');
  for (let index = 0; index < NANJING_CIVILIAN_COUNT; index++) {
    const ageGroup = index % 10 === 0 ? 'child' : index % 10 === 1 ? 'elderly' : 'adult';
    const presentation = (ageGroup === 'adult' ? index : Math.floor(index / 10)) % 2 === 0 ? 'woman' : 'man';
    const carrying = ageGroup === 'adult' && index % 17 === 7 ? 'child'
      : ageGroup !== 'child' && index % 12 === 5 ? 'luggage' : 'none';
    const group = civilianCharacters.create(index, ageGroup, presentation, carrying);
    const home = civilianHomes[index >= 60 && index < 70
      ? Math.floor((index - 60) * civilianHomes.length / 10) : index % civilianHomes.length];
    const start = index < NANJING_OPENING_CIVILIAN_COUNT ? nanjingOpeningCivilianStart(index) : home.exit;
    const startX = start.x;
    const startZ = start.z;
    group.position.set(startX, 0, startZ);
    group.visible = false;
    Object.assign(group.userData, { civilianId: index, homeId: home.id, startX, startZ,
      openingWave: index < NANJING_OPENING_CIVILIAN_COUNT,
      populationKind: index < 60 ? 'refugee' : 'resident', flightReleaseAt: null, fleeReleased: false,
      resting: false, restPoseWeight: 0,
      withdrawalWave: index >= NANJING_OPENING_CIVILIAN_COUNT,
      releaseAt: index >= NANJING_OPENING_CIVILIAN_COUNT ? Infinity : nanjingOpeningCivilianReleaseAt(index),
      ageGroup, presentation, carrying, walkPhase: index * .71,
      waypoint: 0, arrived: false, dead: false, health: 100, waitingSlot: civilianWaitingSlot(index) });
    scene.add(group);
    civilians.push(group);
  }

  const aircraft = Array.from({ length: AIR_SUPPORT.count }, (_, index) => {
    const model = planeModel('enemy');
    model.userData.attack = createAirSupport(index);
    model.userData.gun = { settings: { ...AIRCRAFT_GUN, damage: TYPES.plane.damage }, lastShot: null };
    resetAircraftPose(model);
    scene.add(model);
    return model;
  });
  function resetAircraftPose(model) {
    const { phase, index, pitch, heading, roll } = model.userData.attack;
    model.position.set(-AIR_SUPPORT.orbitWidth + AIR_SUPPORT.orbitWidth * Math.cos(phase),
      AIR_SUPPORT.altitude + index * 3, -AIR_SUPPORT.orbitLength * Math.sin(phase));
    model.rotation.set(pitch, heading, roll, 'YXZ');
  }

  const smokePixels = new Uint8Array(64 * 64 * 4);
  for (let py = 0; py < 64; py++) for (let px = 0; px < 64; px++) {
    const offset = (py * 64 + px) * 4;
    const distance = Math.hypot((px - 31.5) / 31.5, (py - 31.5) / 31.5);
    const grain = .8 + .12 * Math.cos(px * .17) * Math.cos(py * .19) +
      .08 * Math.sin(px * .37 + py * .21) * Math.sin(py * .29 - px * .13);
    smokePixels.set([55, 52, 48, Math.round(240 * Math.max(0, 1 - distance) ** 1.4 * grain)], offset);
  }
  const smokeTexture = new THREE.DataTexture(smokePixels, 64, 64);
  smokeTexture.colorSpace = THREE.SRGBColorSpace;
  smokeTexture.minFilter = smokeTexture.magFilter = THREE.LinearFilter;
  smokeTexture.needsUpdate = true;
  const smokeMaterial = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true,
    opacity: .8, depthWrite: false });
  const burningHomes = [];
  for (const [x, z] of [[-42, -6], [42, -6], [-38, -26], [36, -36], [-48, -56], [46, -76],
    [-28, -82], [14, -90], [76, -86], [83, -55], [63, -24], [8, -39]]) {
    const home = residentialBuildings.filter(home => home.damaged && !burningHomes.includes(home))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    burningHomes.push(home);
  }
  for (const home of burningHomes) {
    for (let layer = 0; layer < 5; layer++) {
      const phase = layer / 5;
      const puff = new THREE.Sprite(smokeMaterial);
      puff.userData = { originX: home.x + 1, originY: home.height - .3, originZ: home.z,
        phase, homeId: home.id };
      puff.scale.setScalar(5 + phase * 16);
      puff.position.set(home.x + 1 + phase * 8, home.height - .3 + phase * 27, home.z);
      scene.add(puff);
      smoke.push(puff);
    }
    const facadeWidth = home.facing % 2 ? home.depth : home.width;
    const facadeDepth = home.facing % 2 ? home.width : home.depth;
    const yaw = home.facing * Math.PI / 2;
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(facadeWidth * .9, home.height),
      new THREE.MeshBasicMaterial({ map: smokeTexture, color: 0x15120f, transparent: true,
        opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    scorch.position.set(home.x + .3 * Math.cos(yaw) - (facadeDepth / 2 + .14) * Math.sin(yaw),
      home.height * .55, home.z - .3 * Math.sin(yaw) - (facadeDepth / 2 + .14) * Math.cos(yaw));
    scorch.rotation.y = yaw;
    scorch.userData.nanjingFeature = 'burned-house-soot';
    scene.add(scorch);
  }
  for (const [index, { x, z, wall, heading }] of NANJING_WALL_PLUMES.entries()) {
    const originY = (wall === 'north' ? 10 : WALL_WALK.height) - .65;
    const originX = x - Math.sin(heading) * .22, originZ = z - Math.cos(heading) * .22;
    const first = Math.floor(index * smoke.length / NANJING_WALL_PLUMES.length / 5) * 5;
    for (let layer = 0; layer < 5; layer++) {
      const phase = layer / 5;
      const puff = new THREE.Sprite(smokeMaterial);
      puff.userData = { originX, originY, originZ,
        phase, homeId: `wall-damage-${index}`, rise: 10, drift: 3, size: 3.1, spread: 4 };
      puff.position.set(originX + phase * 3, originY + phase * 10, originZ);
      puff.scale.setScalar(3.1 + phase * 4);
      scene.add(puff);
      smoke.splice(first + layer, 0, puff);
    }
  }

  for (const point of NANJING_OBJECTIVES.filter(objective => objective.capturePoint)) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 6, 8), timber);
    pole.position.set(point.x, 3, point.z);
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1), new THREE.MeshStandardMaterial({
      color: 0xa19469, side: THREE.DoubleSide, roughness: 1,
    }));
    flag.position.set(point.x + .9, 5.3, point.z);
    scene.add(flag);
    flags.push(flag);
    const marker = new THREE.Mesh(new THREE.RingGeometry(point.radius - .18, point.radius, 64),
      new THREE.MeshBasicMaterial({ color: 0xe7bd65, transparent: true, opacity: .85,
        side: THREE.DoubleSide, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(point.x, .035, point.z);
    marker.userData.nanjingFeature = 'gate-capture-boundary';
    scene.add(marker);
  }

  for (const gate of gateways) for (const side of [-1, 1]) for (let mark = 0; mark < 16; mark++) {
    const seed = mark + gate.z * 11 + side * 23;
    shellPocks(side * (3.3 + (Math.sin(seed * 7.13) + 1) * 3),
      .8 + (Math.sin(seed * 4.77) + 1) * 2.1,
      gate.z - gate.depth / 2, .045 + (Math.sin(seed * 3.91) + 1) * .065, seed);
  }
  const impacts = new THREE.Mesh(mergeGeometries(impactGeometry),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  impacts.userData.nanjingFeature = 'masonry-shell-pocks';
  scene.add(impacts);
  for (const geometry of impactGeometry) geometry.dispose();
  const wreckMesh = (geometry, material, x, y, z, solid, parent) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = true;
    parent.add(object);
    if (solid) solids.push(object);
    return object;
  };
  const wrecks = addStaticWrecks(scene, {
    wrecks: [
      { id: 'nanjing-west-market-truck', type: 'truck', x: -15, z: -61, heading: 0 },
      { id: 'nanjing-east-market-tank', type: 'tank', x: 25, z: -65, heading: .18 },
      { id: 'nanjing-east-market-truck', type: 'truck', x: 80, z: -62, heading: -.2 },
    ],
    obstacles, groundHeight, timber,
    mesh: wreckMesh,
    box(x, y, z, width, height, depth, material, solid, parent) {
      const object = wreckMesh(boxGeometry, material, x, y, z, solid, parent);
      object.scale.set(width, height, depth);
      return object;
    },
  });
  const trees = [];
  const treeBark = Object.fromEntries(Object.keys(WOODLAND_SPECIES).map(species => {
    const material = surface(`bark-${species}`);
    material.vertexColors = true;
    return [species, material];
  }));
  for (let index = 0; index < 12; index++) {
    const species = index % 2 ? 'willow' : 'elm', height = 5 + index % 3;
    const x = NANJING_RIVER_SHORE_X + 12 + (index % 4) * 11;
    const z = -148 - Math.floor(index / 4) * 45 - index % 3 * 4;
    const tree = { x, z, species, height, radius: height * WOODLAND_SPECIES[species].girth,
      seed: 4937 + index, age: 'adult', dead: true, sparse: true, heading: index * 2.39 };
    const mesh = new THREE.Mesh(woodlandTreeGeometry(tree).bark, treeBark[species]);
    mesh.position.set(x, -.16, z);
    mesh.userData.nanjingFeature = 'north-distant-tree';
    mesh.userData.keepUV = true;
    scene.add(mesh);
  }
  const candidates = [
    ...[-100, -54, -34, -14, 8, 28, 76].map(z => [-67, z]),
    ...[-81, -61, -41, -21, 9].flatMap(z => [-56, -43, -33, -23, -13, 17, 29, 41, 51, 61, 83, 95].map(x => [x, z])),
    ...[-49, -34, 18, 38, 58, 78, 96].map(x => [x, 34]),
    [-92, -70, true], [-104, -67, true],
  ];
  for (const [index, [baseX, baseZ, riverside]] of candidates.entries()) {
    const x = baseX + Math.sin(index * 2.71) * .32, z = baseZ + Math.cos(index * 1.79) * .3;
    if (trees.length >= (riverside ? 42 : 40) || Math.abs(x) < 7 || Math.abs(z + 60) < 3 ||
      !riverside && x < -39 && z < -64 && z > -97 || Math.abs(x + 24) < 9 && z > 25 ||
      circleBlocked(x, z, 1, obstacles) ||
      NANJING_SPAWNS.some(spawn => spawn.id.startsWith('nanjing-reserve-') &&
        Math.hypot(x - spawn.x, z - spawn.z) < 6) ||
      northernBackdrop.some(home => Math.abs(x - home.x) < home.width / 2 + 1 &&
        Math.abs(z - home.z) < home.depth / 2 + 1) ||
      residentialBuildings.some(home => Math.abs(x - home.x) < home.width / 2 + .75 &&
        Math.abs(z - home.z) < home.depth / 2 + .75 ||
        Math.hypot(x - home.exit.x, z - home.exit.z) < 1.5) ||
      cityLayout.streets.some(street => street.width >= 4.8 &&
        cityStreetIntersectsLot([x, z, 2, 2], street)) ||
      trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < 4)) continue;
    const species = x < -64 ? 'willow' : index % 4 === 0 ? 'poplar' : 'elm';
    const profile = WOODLAND_SPECIES[species], height = 5 + (Math.sin(index * 8.31) + 1) * 1.6;
    const tree = { x, z, species, height, radius: height * profile.girth, seed: 1937 + index,
      age: index % 7 === 0 ? 'sapling' : 'adult', dead: true,
      sparse: index % 5 === 0, heading: index * 2.39 };
    const mesh = new THREE.Mesh(woodlandTreeGeometry(tree).bark, treeBark[species]);
    mesh.position.set(x, -.16, z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.nanjingFeature = 'city-tree';
    mesh.userData.keepUV = true;
    scene.add(mesh); solids.push(mesh);
    obstacles.push({ minX: x - tree.radius, maxX: x + tree.radius,
      minZ: z - tree.radius, maxZ: z + tree.radius, height: height * .8,
      circular: true, cx: x, cz: z, radius: tree.radius });
    trees.push(tree);
  }
  sceneArt.woodland = { trees: trees.length, leafStyle: 'bare-branches',
    species: Object.fromEntries(Object.keys(WOODLAND_SPECIES).map(species =>
      [species, trees.filter(tree => tree.species === species).length])) };
  obstacles.push(...NANJING_EMPLACEMENTS.flatMap(emplacementObstacles));
  const doorSystem = createDoorWorld(scene, town, obstacles, solids, timber, stone);
  const civilianNavigationObstacles = [...doorSystem.navigationObstacles,
    ...residentialBuildings.map(home => ({
      minX: home.x - home.width / 2, maxX: home.x + home.width / 2,
      minZ: home.z - home.depth / 2, maxZ: home.z + home.depth / 2, height: home.height, civilianHomeId: home.id,
    }))];
  const civilianNavigate = createNavigator(civilianNavigationObstacles, .5, .45);
  const openingCivilianSources = NANJING_OPENING_SOURCES.filter(point =>
    !circleBlocked(point.x, point.z, .45, civilianNavigationObstacles)).map(point => ({
    ...point, path: civilianNavigate(point, NANJING_OPENING_BRIDGE_TARGET),
  })).filter(point => point.path.length &&
    Math.hypot(point.path.at(-1).x - NANJING_OPENING_BRIDGE_TARGET.x,
      point.path.at(-1).z - NANJING_OPENING_BRIDGE_TARGET.z) < .02);
  for (const home of residentialBuildings.filter(item => openingHouseCovers.has(item.id))) {
    const door = doorSystem.doors.find(item => item.id === `${home.id}-door`);
    if (!door) throw new Error(`Opening refugee house ${home.id} has no door`);
    const navigationObstacles = civilianNavigationObstacles.filter(obstacle =>
      obstacle.civilianHomeId !== home.id && (obstacle.height ?? Infinity) > .24);
    const navigate = createNavigator(navigationObstacles, .5, .36);
    const onward = civilianNavigate(home.exit, NANJING_OPENING_BRIDGE_TARGET);
    if (!onward.length) throw new Error(`Opening refugee house ${home.id} cannot reach the bridge`);
    const street = { navigate, door, exit: home.exit, navigationObstacles,
      navigationLookup: obstacleLookup(navigationObstacles, .8),
      movementObstacles: obstacles.filter(obstacle => (obstacle.height ?? Infinity) > .24) };
    const doorObstacle = obstacles.find(obstacle => obstacle.door && obstacle.id === door.id);
    if (!doorObstacle) throw new Error(`Opening refugee house ${home.id} has no door collider`);
    doorSystem.addNavigationListener(() => {
      const active = doorSystem.navigationObstacles.includes(doorObstacle);
      const index = navigationObstacles.indexOf(doorObstacle);
      if (active === (index >= 0)) return;
      if (active) navigationObstacles.push(doorObstacle);
      else navigationObstacles.splice(index, 1);
      street.navigationLookup.rebuild();
      navigate.refresh({ minX: door.x - door.width - 1, maxX: door.x + door.width + 1,
        minZ: door.z - door.width - 1, maxZ: door.z + door.width + 1 });
    });
    for (const offset of [-2.1, -1, 1, 2.1]) {
      const point = { x: home.x + offset, z: home.z + 1 };
      const exit = navigate(point, home.exit);
      if (!exit.length) throw new Error(`Opening refugee house ${home.id} has no interior exit`);
      openingCivilianSources.push({ ...point, path: [...exit, ...onward],
        cover: openingHouseCovers.get(home.id), street });
    }
    for (const offset of [-2, -1, 0, 1, 2]) {
      const point = { x: home.x + offset, z: home.z + home.depth / 2 + 1.5 };
      if (circleBlocked(point.x, point.z, .45, civilianNavigationObstacles)) continue;
      const path = civilianNavigate(point, NANJING_OPENING_BRIDGE_TARGET);
      if (path.length && Math.hypot(path.at(-1).x - NANJING_OPENING_BRIDGE_TARGET.x,
        path.at(-1).z - NANJING_OPENING_BRIDGE_TARGET.z) < .02)
        openingCivilianSources.push({ ...point, path, cover: openingHouseCovers.get(home.id) });
    }
  }
  if (!openingCivilianSources.length) throw new Error('No reachable south-bank source for opening refugees');
  const waitingPlaces = placeCivilianWaitingSlots(point =>
    !circleBlocked(point.x, point.z, .45, civilianNavigationObstacles));
  const homeRoutes = new Map();
  const routeSegments = new Map();
  for (const civilian of civilians) {
    const data = civilian.userData;
    data.waitingSlot = waitingPlaces[data.civilianId];
    if (!homeRoutes.has(data.civilianId)) {
      const start = { x: data.startX, z: data.startZ };
      const entry = { x: NANJING_DOCK_ENTRY_X + 3.8, z: NANJING_DOCK.z };
      const stops = data.civilianId >= 60
        ? [{ x: -37, z: -62 }, data.waitingSlot]
        : [NANJING_OPENING_BRIDGE_TARGET, { x: 0, z: 24 }, { x: 0, z: 15 },
          { x: 0, z: 3 }, { x: 0, z: -12 }, { x: -56, z: -60 }, entry, data.waitingSlot];
      const route = [];
      let from = start;
      for (const stop of stops) {
        const key = `${from.x},${from.z}:${stop.x},${stop.z}`;
        let path = routeSegments.get(key);
        if (!path) {
          path = civilianNavigate(from, stop);
          if (path.length) routeSegments.set(key, path);
        }
        if (!path.length) throw new Error(`Civilian home ${data.homeId} has no evacuation route: ` +
          `${civilianNavigate.stats.reason} from ${JSON.stringify(from)} to ${JSON.stringify(stop)}`);
        route.push(...path);
        from = stop;
      }
      homeRoutes.set(data.civilianId, route);
    }
    data.route = homeRoutes.get(data.civilianId);
    data.homeRoute = data.route;
    if (data.civilianId >= 60 && data.civilianId < 70) {
      const home = civilianHomes.find(item => item.id === data.homeId);
      const door = doorSystem.doors.find(item => item.id === `${home.id}-door`);
      const outward = { x: home.exit.x - door.x, z: home.exit.z - door.z };
      const length = Math.hypot(outward.x, outward.z);
      const inside = { x: door.x - outward.x / length * 1.8, z: door.z - outward.z / length * 1.8 };
      const navigationObstacles = civilianNavigationObstacles.filter(obstacle =>
        obstacle.civilianHomeId !== home.id && (obstacle.height ?? Infinity) > .24);
      const navigate = createNavigator(navigationObstacles, .5, .36);
      const neighbor = civilianHomes.filter(item => item !== home &&
        Math.hypot(item.exit.x - home.exit.x, item.exit.z - home.exit.z) > 5)
        .sort((a, b) => Math.hypot(a.exit.x - home.exit.x, a.exit.z - home.exit.z) -
          Math.hypot(b.exit.x - home.exit.x, b.exit.z - home.exit.z))[0];
      const outwardPath = navigate(home.exit, neighbor.exit);
      if (!outwardPath.length) throw new Error(`Street civilian ${data.civilianId} has no neighborhood route`);
      const route = [home.exit, ...outwardPath, ...outwardPath.slice(0, -1).reverse(), home.exit, inside];
      const initialWaypoint = data.civilianId % 2 ? Math.max(1, Math.floor(outwardPath.length / 2)) : 0;
      data.streetLife = { route, navigate, door, exit: home.exit, navigationObstacles,
        navigationLookup: obstacleLookup(navigationObstacles,.8),
        movementObstacles: obstacles.filter(obstacle => (obstacle.height ?? Infinity) > .24),
        initialWaypoint, initialPosition: initialWaypoint ? route[initialWaypoint - 1] : inside,
        initialDelay: initialWaypoint ? 0 : (data.civilianId - 60) * 1.3 };
      resetCivilianStreetLife(civilian);
    }
  }
  const firstRefugeeRoute = civilians[0].userData.homeRoute;
  const cityStart = firstRefugeeRoute.findIndex(point => Math.hypot(point.x, point.z + 12) < .02);
  const cityEnd = firstRefugeeRoute.findIndex((point, index) => index > cityStart && Math.hypot(point.x + 56, point.z + 60) < .02);
  if (cityStart < 0 || cityEnd <= cityStart) throw new Error('Refugee route lacks its inspected city segment');
  const cityRoute = firstRefugeeRoute.slice(cityStart, cityEnd + 1);
  const restLookup = obstacleLookup(civilianNavigationObstacles, .8);
  const restPlaces = placeRefugeeRestGroups(cityLayout.streets, cityRoute, civilianNavigationObstacles, restLookup);
  for (const civilian of civilians.filter(person => person.userData.openingWave)) {
    const data = civilian.userData, place = restPlaces[data.civilianId];
    const start = data.homeRoute.findIndex(point => Math.hypot(point.x, point.z + 12) < .02);
    if (start < 0) throw new Error(`Refugee ${data.civilianId} cannot reach its city rest point`);
    data.refugeeRestPoint = { x: place.x, z: place.z };
    data.restGroup = place.group; data.restPose = place.pose; data.restHeading = place.heading;
    data.refugeeRestRoute = [...data.homeRoute.slice(0, start + place.connection.index + 1),
      { ...place.connection.join }, data.refugeeRestPoint];
    data.refugeeResumeRoute = [{ ...place.connection.join }, ...data.homeRoute.slice(start + place.connection.index + 1)];
    data.route = data.refugeeRestRoute;
  }
  const civilianFlight = {};
  resetCivilianFlight(civilianFlight);
  const walkSupports = [
    ...NANJING_WALL_WALKS.map(walk => ({ ...walk })),
    ...flankWalkSupports,
    ...gateways.map(gate => ({
      minX: -gate.width / 2, maxX: gate.width / 2,
      minZ: gate.z - gate.depth / 2, maxZ: gate.z + gate.depth / 2,
      height: WALL_WALK.height,
    })),
    { minX: cave.x - cave.width / 2, maxX: cave.x + cave.width / 2,
      minZ: cave.z - cave.depth / 2, maxZ: cave.z + cave.depth / 2, height: cave.floorHeight },
  ];
  function walkHeight(x, z, referenceY = groundHeight(x, z), step = .24) {
    let height = groundHeight(x, z);
    const roomHeight = casemateFloorAt(x, z);
    if (roomHeight !== null && roomHeight <= referenceY + step) height = Math.max(height, roomHeight);
    for (const support of walkSupports) {
      if (x < support.minX || x > support.maxX || z < support.minZ || z > support.maxZ ||
        support.height > referenceY + step || support.height <= height) continue;
      height = support.height;
    }
    for (const ramp of NANJING_WALL_RAMPS) {
      if (x < ramp.minX || x > ramp.maxX || z < ramp.minZ || z > ramp.maxZ) continue;
      const progress = ramp.side > 0
        ? (x - ramp.minX) / ramp.length
        : (ramp.maxX - x) / ramp.length;
      const rampHeight = progress * ramp.height;
      if (rampHeight <= referenceY + step && rampHeight > height) height = rampHeight;
    }
    let stairHeight = null;
    if (x > westGateStair.maxX && x <= westGateStair.groundX &&
      z >= westGateStair.turnZ && z <= westGateStair.topZ)
      stairHeight = (westGateStair.topZ - z) / flightLength * stairHalfHeight;
    else if (x >= westGateStair.minX && x <= westGateStair.maxX &&
      z >= westGateStair.turnZ && z <= westGateStair.topZ)
      stairHeight = stairHalfHeight + (z - westGateStair.turnZ) / flightLength * stairHalfHeight;
    if (stairHeight !== null && stairHeight <= referenceY + step && stairHeight > height) height = stairHeight;
    return height;
  }
  function moveNanjingInfantry(position, dx, dz, radius, movementObstacles = obstacles, bodyHeight = 1.75) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .2));
    const attempt = (x, z) => {
      const height = walkHeight(x, z, position.y);
      if (height - position.y > .25 || position.y - height > .65) return;
      const blockers = movementObstacles.filter(obstacle =>
        !(obstacle.walkable && (obstacle.height ?? 0) <= height + .5));
      if (Number.isFinite(x) && Number.isFinite(z) &&
        !circleBlocked(x, z, radius, blockers, height, bodyHeight)) {
        position.x = x; position.z = z; position.y = height;
      }
    };
    for (let index = 0; index < steps; index++) {
      attempt(position.x + dx / steps, position.z);
      attempt(position.x, position.z + dz / steps);
    }
    return position;
  }
  function wallElevatedPath(start, goal) {
    if (start.y < 7 || goal.y < 7 || goal.y === undefined) return null;
    const clear = (from, to) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .2));
      for (let step = 1; step <= steps; step++) {
        const x = from.x + (to.x - from.x) * step / steps;
        const z = from.z + (to.z - from.z) * step / steps;
        if (Math.abs(walkHeight(x, z, start.y) - start.y) > .24 ||
          circleBlocked(x, z, .42, obstacles, start.y)) return false;
      }
      return true;
    };
    if (clear(start, goal)) return [{ ...goal }];
    const gate = gateways.find(gate => Math.abs(goal.z - gate.z) <= gate.depth / 2);
    if (gate) {
      const route = [{ x: start.x, y: start.y, z: gate.z },
        { x: goal.x, y: start.y, z: gate.z }, { ...goal }];
      if (route.every((point, index) => clear(index ? route[index - 1] : start, point))) return route;
    }
    const startGate = gateways.find(gate => Math.abs(start.z - gate.z) <= gate.depth / 2);
    const goalWall = NANJING_WALL_WALKS.find(walk => goal.x >= walk.minX && goal.x <= walk.maxX);
    if (startGate && goalWall) {
      const wallX = (goalWall.minX + goalWall.maxX) / 2;
      const route = [{ x: start.x, y: start.y, z: startGate.z },
        { x: wallX, y: start.y, z: startGate.z },
        { x: wallX, y: start.y, z: goal.z }, { ...goal }];
      if (route.every((point, index) => clear(index ? route[index - 1] : start, point))) return route;
    }
    // Rejoin the wall centre before turning past merlons or across a gate crown.
    const wall = NANJING_WALL_WALKS.find(walk => Math.sign(walk.minX) === Math.sign(start.x));
    if (!wall) return [];
    for (const offset of [0, -1.2, 1.2, -2.4, 2.4]) {
      const escape = { x: start.x, y: start.y, z: start.z + offset };
      const entry = { x: (wall.minX + wall.maxX) / 2, y: start.y, z: start.z + offset };
      const corner = { x: entry.x, y: start.y, z: gate?.z ?? goal.z };
      const crossing = { x: goal.x, y: start.y, z: corner.z };
      const route = [escape, entry, corner, crossing, { ...goal }];
      if (route.every((point, index) => clear(index ? route[index - 1] : start, point))) return route;
    }
    return [];
  }
  function casemateConnection(start, goal) {
    const position = new THREE.Vector3(start.x, start.y ?? 0, start.z), path = [];
    const count = Math.max(1, Math.ceil(Math.hypot(goal.x - start.x, goal.z - start.z) / .1));
    for (let step = 1; step <= count; step++) {
      const x = start.x + (goal.x - start.x) * step / count, z = start.z + (goal.z - start.z) * step / count;
      moveNanjingInfantry(position, x - position.x, z - position.z, .42,
        casemateObstaclesAt(position.x, position.z));
      if (Math.hypot(position.x - x, position.z - z) > .025) return [];
      path.push({ x: position.x, y: position.y, z: position.z });
    }
    return Math.abs(position.y - (goal.y ?? 0)) < .025 ? path : [];
  }
  function routeToCasemateEntrance(point) {
    if (!groundNavigation) throw new Error('Casemate routing requires the battle ground navigator');
    const path = [], position = { ...point };
    if ((point.y ?? 0) > .5) {
      const side = point.x < 0 ? -1 : 1;
      const ramp = NANJING_WALL_RAMPS.find(candidate => candidate.side === side);
      const walk = NANJING_WALL_WALKS.find(candidate => Math.sign(candidate.minX) === side);
      const high = { x: (walk.minX + walk.maxX) / 2,
        y: ramp.height, z: ramp.centerZ };
      const onRamp = point.x >= ramp.minX && point.x <= ramp.maxX &&
        point.z >= ramp.minZ && point.z <= ramp.maxZ;
      if (!onRamp) {
        const top = wallElevatedPath(point, high);
        if (!top?.length) return [];
        path.push(...top); Object.assign(position, high);
      }
      for (let step = 1; step <= 80; step++) {
        const x = position.x + (ramp.side < 0 ? ramp.maxX + .3 - position.x : ramp.minX - .3 - position.x) * step / 80;
        path.push({ x, y: walkHeight(x, ramp.centerZ, position.y), z: ramp.centerZ });
      }
      Object.assign(position, path.at(-1));
    }
    const ground = groundNavigation(position, casemate.entrance);
    if (!ground.length) return [];
    return [...path, ...ground.map(node => ({ ...node, y: 0 }))];
  }
  function westGateStairPath(start, goal) {
    const high = point => (point.y ?? 0) > 8.3 && point.x >= -74.2 && point.x <= -69.8 &&
      point.z >= NANJING_WEST_BREACH.maxZ && point.z <= NANJING_WEST_GATE_Z + westGateRadius;
    const onStair = point => {
      const { x, z, y = 0 } = point;
      const inLower = x >= westGateStair.maxX && x <= westGateStair.groundX &&
        z >= westGateStair.minZ && z <= westGateStair.topZ;
      const inUpper = x >= westGateStair.minX && x <= westGateStair.maxX &&
        z >= westGateStair.minZ && z <= westGateStair.topZ + .6;
      return y >= .3 && (inLower || inUpper) && Math.abs(walkHeight(x, z, y) - y) < .15;
    };
    const kind = point => high(point) ? 'high' : onStair(point) ? 'stair' : (point.y ?? 0) < .3 ? 'ground' : null;
    const startKind = kind(start), goalKind = kind(goal);
    if (!startKind || !goalKind || startKind === 'ground' && goalKind === 'ground') return null;
    if (startKind === 'high' && goalKind === 'high') return null;
    if (!groundNavigation) throw new Error('West gate routing requires the battle ground navigator');
    const bottom = { x: (westGateStair.maxX + westGateStair.groundX) / 2, y: 0,
      z: westGateStair.topZ + .2 };
    const lowerTurn = { x: bottom.x, y: stairHalfHeight, z: (westGateStair.minZ + westGateStair.turnZ) / 2 };
    const turn = { x: (westGateStair.minX + westGateStair.maxX) / 2, y: stairHalfHeight, z: lowerTurn.z };
    const stairTop = { x: turn.x, y: WALL_WALK.height, z: westGateStair.topZ + .3 };
    const wallTop = { x: -70.25, y: WALL_WALK.height, z: stairTop.z };
    const lowerFlight = casemateConnection(bottom, lowerTurn);
    const landing = casemateConnection(lowerTurn, turn);
    const upperFlight = casemateConnection(turn, stairTop);
    const crossing = casemateConnection(stairTop, wallTop);
    if (!lowerFlight.length || !landing.length || !upperFlight.length || !crossing.length) return [];
    const spine = [bottom, ...lowerFlight, ...landing, ...upperFlight, ...crossing];
    const connect = (point, type) => {
      if (type === 'ground') {
        const path = Math.hypot(point.x - bottom.x, point.z - bottom.z) < .05
          ? [] : groundNavigation(point, bottom).map(node => ({ ...node, y: 0 }));
        return path.length || Math.hypot(point.x - bottom.x, point.z - bottom.z) < .05
          ? { index: 0, path } : null;
      }
      if (type === 'high') {
        const path = wallElevatedPath(point, wallTop);
        return path?.length ? { index: spine.length - 1, path } : null;
      }
      let index = 0, distance = Infinity;
      for (let i = 0; i < spine.length; i++) {
        const node = spine[i], d = Math.hypot(node.x - point.x, node.y - point.y, node.z - point.z);
        if (d < distance) { distance = d; index = i; }
      }
      const path = casemateConnection(point, spine[index]);
      return path.length ? { index, path } : null;
    };
    const from = connect(start, startKind), to = connect(goal, goalKind);
    if (!from || !to) return [];
    const between = from.index <= to.index ? spine.slice(from.index, to.index + 1)
      : spine.slice(to.index, from.index + 1).reverse();
    return [...from.path, ...between, ...[{ ...goal }, ...to.path].reverse()];
  }
  function elevatedPath(start, goal) {
    const westGateRoute = westGateStairPath(start, goal);
    if (westGateRoute !== null) return westGateRoute;
    const roomRoute = casemateRoute(start, goal, casemateConnection, routeToCasemateEntrance);
    return roomRoute ?? wallElevatedPath(start, goal);
  }
  const groundSurface = (x, z) => breachHeight(x, z) > 0 ? 'stone' : aaPlatformHeight(x, z) > 0 ||
    x >= NANJING_PIER.minX && x <= NANJING_PIER.maxX && z >= NANJING_PIER.minZ && z <= NANJING_PIER.maxZ ? 'wood'
    : Math.abs(z - 52) < 13 || Math.abs(x - RIVERS[1].x) < 12
      ? 'earth' : Math.abs(x) < 6 || Math.abs(x + 40) < 30 && Math.abs(z) < 6 ? 'stone' : 'earth';
  const masonryFeatures = new Set(['brick-parapet', 'brick-parapet-ledge',
    'west-wall-stair-tread', 'east-wall-stair-tread', 'west-gate-stair-tread', 'river-stone-bank',
    'city-lane', 'arched-gateway', 'soldier-cave-frame', 'flanking-masonry-core',
    'flanking-ramp-cheek', 'wall-walk',
    'soldier-cave-wing', 'barbican-curtain-wall', 'city-wall', 'northern-city-wall',
    'casemate-stair-tread', 'casemate-stair-ceiling', 'casemate-floor', 'casemate-ceiling', 'casemate-plaster']);
  shellCraters.push(...selectBattlefieldCraters({
    bounds: { minX: -67, maxX: 98, minZ: -100, maxZ: 96 }, obstacles,
    reserved: [...residentialBuildings.map(home => {
      const radius = Math.max(home.width, home.depth) / 2;
      return { minX: home.x - radius, maxX: home.x + radius, minZ: home.z - radius, maxZ: home.z + radius };
    }), { minX: -29, maxX: 29, minZ: -8, maxZ: 36 },
      { minX: -78, maxX: -55, minZ: -96, maxZ: -65 },
      { minX: -8, maxX: 8, minZ: -108, maxZ: 108 }],
    spawns: [...NANJING_SPAWNS, ...NANJING_OBJECTIVES],
    dry: (x, z) => !(Math.abs(z - 52) < 16 || x < -70) && groundHeight(x, z) === 0,
  }));
  craterSupport = addBattlefieldCraters(scene, terrainSurfaces, solids, shellCraters, ground);
  const buildingFire = createBuildingFire(scene, residentialBuildings, { flames: false });
  const masonryMeshes = [...damagedWallFaces, ...solids.filter(mesh => mesh.isMesh &&
    masonryFeatures.has(mesh.userData.nanjingFeature) && !mesh.userData.nanjingBattleDamage &&
    !mesh.isInstancedMesh && !mesh.isSkinnedMesh && !Array.isArray(mesh.material) && !mesh.material.transparent)];
  const staticRendering = batchStaticScene(scene, [...new Set([...residentialMeshes, ...masonryMeshes])]);
  staticRendering.masonrySources = masonryMeshes.length;
  sceneArt.staticRendering = staticRendering;
  return {
    solids, obstacles, smoke, flags, boxGeometry, groundSurface, groundHeight, walkHeight,
    moveInfantry: moveNanjingInfantry, elevatedPath, staticRendering,
    casemateContains: inNanjingCasemate,
    casemateNearby: nearNanjingCasemate,
    setGroundNavigation(navigator, query = null) {
      if (typeof navigator !== 'function' || query !== null && typeof query !== 'function')
        throw new TypeError('Ground navigation and collision queries must be functions');
      groundNavigation = navigator;
      if (query) casemateObstaclesAt = query;
      else {
        const lookup = obstacleLookup(obstacles, 2.5, 4);
        casemateObstaclesAt = (x, z) => lookup.at(x, z);
      }
    },
    bridgeSurfaces: { deck: 0, northRamp: 0, southRamp: 0 },
    updateWater(time) {
      waterWaves.update(time, scene.fog?.color);
    },
    riverSurfaces: { water: SOUTH_RIVER_WATER, southBank: 0, northBank: 0, street: 0 },
    armorObstacles: obstacles,
    town, outskirts: { buildings: [], hills: [] }, visibility: {}, doorSystem, sceneArt,
    buildingFire, staticDamage: { craters: shellCraters, ruinedShops: [], wrecks },
    ferries, ferryRowers, civilianVisuals: [...civilians, ...ferryRowers], civilians, civilianQueue, civilianFlight,
    civilianNavigate, civilianNavigationObstacles, openingCivilianSources, aircraft, objectives: NANJING_OBJECTIVES, impactHeight,
    isDeepWater: (x, z) => x < NANJING_RIVER_SHORE_X && x > NANJING_RIVER_SHORE_X - NANJING_FERRY_ROUTE.riverWidth &&
      Math.abs(z) < NANJING_FERRY_ROUTE.riverDepth / 2 &&
      !(x >= NANJING_PIER.minX && z >= NANJING_PIER.minZ && z <= NANJING_PIER.maxZ) ||
      Math.abs(z - 52) < 13 && x > NANJING_RIVER_SHORE_X && x < 105,
    landmarks: {
      temple: templeLandmark,
      gatehouse: { style: 'arched-stone-gate', gates: gateways, barbicans: NANJING_COURTYARDS.length,
        centerZ: (NANJING_GATE_NORTH_EDGE + NANJING_GATE_SOUTH_EDGE) / 2,
        footprint: { width: GATE_WIDTH, length: GATE_LENGTH, height: NANJING_GATE_HEIGHT },
        sourceDimensionsMeters: { width: 118.5, length: 128, rampartHeight: 20.45, gatehouseHeight: 21.45 },
        wallThickness: NANJING_RAMPART_THICKNESS,
        tunnel: { ...NANJING_GATE_TUNNEL }, scale: NANJING_MAP_SCALE },
      courtyards: barbicans,
      flankingBuffers: NANJING_FLANKING_BUFFERS,
      flankingStructures,
      bridges,
      bridgeDeckDefenses,
      cityWalls: NANJING_CITY_WALLS,
      cityWallSections: flankWalkSupports,
      wallBreaches,
      westWallBreach: NANJING_WEST_BREACH,
      forwardDefenses,
      gateInteriorDefenses,
      dockDefenses,
      cityRoadblocks,
      rivers: RIVERS,
      trees,
      cityStreets: cityLayout.streets,
      cityFixtures: cityLayout.streetFixtures,
      residentialBuildings,
      northernBackdrop,
      primaryAssaultRoute: 'yuhua-road-bridge-through-jubaomen',
      wallWalk: WALL_WALK,
      wallWalks: NANJING_WALL_WALKS,
      wallRamps: NANJING_WALL_RAMPS,
      wallStair: WALL_STAIR,
      soldierCave: cave,
      soldierCaves: NANJING_SOLDIER_CAVES,
      casemate,
    },
    resetCampaign() {
      civilianQueue.length = 0;
      resetCivilianFlight(civilianFlight);
      for (const civilian of civilians) {
        restoreFerryPassenger(civilian);
        civilian.removeFromParent();
        scene.add(civilian);
        const data = civilian.userData;
        if (data.openingInside) data.streetLife = null;
        civilian.position.set(data.startX, 0, data.startZ);
        civilian.rotation.set(0, 0, 0);
        for (const limb of [...civilian.civilianArms, ...civilian.civilianLegs]) limb.rotation.set(0, 0, 0);
        civilian.civilianTorso.rotation.set(0, 0, 0);
        civilian.civilianHead.rotation.set(0, 0, 0);
        civilian.visible = false;
        Object.assign(data, { waypoint: 0, arrived: false, dead: false, health: 100, active: false, exposure: 0,
          panicked: false, panicStartedAt: null, startledUntil: 0, protectiveUntil: 0,
          lastStartleSound: null, crowdTarget: null, crowdPath: null, crowdStalled: 0,
          crowdDirection: null, crowdYieldTo: null, crowdYieldPoint: null,
          crowdSearch: null, crowdSearchRevision: null,
          threatResponse: null, escapeMotion: null, escapeMode: null,
          threatThinkCount:0,
          routeRejoinAt: 0, routeRejoins: 0, routeRejoinFailures: 0,
          finalRecovery: null,
          unrescued: false, enteredCity: false, crossedRiver: false,
          crowdDetourPoint: null, crowdPathStalled: 0, crowdPathBestDistance: Infinity,
          boarding: false, evacuated: false, deadAt: null,
          streetEvacuating: false, openingInside: false, route: data.refugeeRestRoute ?? data.homeRoute,
          flightReleaseAt: null, fleeReleased: false, resting: false, restPoseWeight: 0,
          releaseAt: data.withdrawalWave ? Infinity : nanjingOpeningCivilianReleaseAt(data.civilianId) });
        for (const bone of civilian.civilianSkin.skeleton.bones) bone.rotation.set(0, 0, 0);
        civilian.civilianSkin.joints.root.position.y = 0;
        resetCivilianStreetLife(civilian);
      }
      for (const ferry of ferries) {
        ferry.userData.passengers = [];
        ferry.userData.boarding = null;
        ferry.userData.civilianRouteRetry = null;
        ferry.userData.loadedAt = null;
        ferry.userData.oar.visible = false;
        ferry.userData.gangplank.visible = true;
        ferry.userData.state = 'docked';
        updateNanjingFerryRower(ferry, 0);
        ferry.position.set(ferry.userData.originX, .05, ferry.userData.originZ);
        ferry.userData.opacity = null;
        updateFerryVisibility(ferry);
      }
      for (const [index, model] of aircraft.entries()) {
        model.userData.propeller.rotation.set(0, 0, 0);
        model.userData.attack = createAirSupport(index);
        model.userData.gun.lastShot = null;
        resetAircraftPose(model);
      }
      doorSystem.reset();
    },
  };
}
