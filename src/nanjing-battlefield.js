import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCivilianCharacterFactory } from './civilian-character.js';
import { resetCivilianStreetLife } from './civilian-street-life.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { circleBlocked, createNavigator } from './core.js';
import { createDoorWorld } from './door-world.js';
import { NANJING_CITY_WALLS, NANJING_DOCK, NANJING_OBJECTIVES, NANJING_SPAWNS } from './nanjing-campaign.js';
import { sandbagCollisionProxy, sandbagGeometry } from './scene-details.js';
import { createRoofGeometry } from './roof-geometry.js';
import { AIR_SUPPORT, createAirSupport } from './air-support.js';
import { AIRCRAFT_GUN } from './aircraft-ai.js';
import { TYPES } from './core.js';
import { batchStaticScene } from './static-scene-batches.js';
import { NANJING_EMPLACEMENTS, emplacementObstacles } from './emplacements.js';
import { planeModel } from './world.js';
import { civilianWaitingSlot, NANJING_CIVILIAN_COUNT, nanjingOpeningCivilianStart,
  nanjingOpeningCivilianReleaseAt, placeCivilianWaitingSlots } from './civilian-crowd.js';
import { cityStreetIntersectsLot, createNanjingCityLayout } from './nanjing-city-layout.js';
import { WOODLAND_SPECIES, woodlandTreeGeometry } from './woodland.js';
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
  { id: 'qinhuai-south', name: '秦淮河南段', x: 0, z: 52, width: 210, depth: 26 },
  { id: 'yangtze-west', name: '长江', x: -84, z: 0, width: 24, depth: 300 },
].map(Object.freeze));

export function makeNanjingBattlefield(scene, surface) {
  const solids = [], obstacles = [], smoke = [], flags = [], ferries = [], civilians = [], civilianQueue = [];
  const flankWalkSupports = [];
  const residentialBuildings = [];
  const northernBackdrop = [];
  const residentialMeshes = [];
  const cityLayout = createNanjingCityLayout();
  const wallBreaches = [{ id: 'east-shell-breach', minX: 88, maxX: 94, minZ: 16, maxZ: 20.4 }];
  const impactGeometry = [];
  const town = { streetWidth: 9, buildings: [], pieces: [], covers: [], passages: [], obstacles: [] };
  const groundHeight = (x, z) => {
    if (x < -73 || x > -57.5 || z < -91.5 || z > -68.5) return 0;
    return .36 * Math.min(1, Math.max(0, (-57.5 - x) / 1.5),
      Math.max(0, (z + 91.5) / 1.5), Math.max(0, (-68.5 - z) / 1.5));
  };
  const impactHeight = (x, z) => {
    const south = RIVERS[0], west = RIVERS[1];
    if (Math.abs(x - south.x) < south.width / 2 && Math.abs(z - south.z) < south.depth / 2)
      return SOUTH_RIVER_WATER;
    if (Math.abs(x - west.x) < west.width / 2 && Math.abs(z - west.z) < west.depth / 2) {
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
  const stone = surface('paving', 0x96896f, 2.4);
  const courtyardGround = surface('earth', 0x62634e, 1.8);
  const timber = surface('timber', 0x594a35, 2);
  const wavePixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const index = (y * 64 + x) * 4;
    wavePixels[index] = 128 + Math.round(32 * Math.sin(x / 64 * Math.PI * 8 + Math.sin(y / 64 * Math.PI * 4)));
    wavePixels[index + 1] = 128 + Math.round(22 * Math.cos(y / 64 * Math.PI * 12 + Math.sin(x / 64 * Math.PI * 4)));
    wavePixels[index + 2] = 250;
    wavePixels[index + 3] = 255;
  }
  const waveTexture = new THREE.DataTexture(wavePixels, 64, 64);
  waveTexture.wrapS = waveTexture.wrapT = THREE.RepeatWrapping;
  waveTexture.repeat.set(18, 8);
  waveTexture.needsUpdate = true;
  const water = new THREE.MeshStandardMaterial({ color: 0x263e35, roughness: .58, metalness: .02,
    normalMap: waveTexture, normalScale: new THREE.Vector2(.24, .24) });
  const burlap = surface('burlap', 0x9a8b67);
  burlap.vertexColors = true;
  const detailedSandbagGeometry = sandbagGeometry();
  const collisionSandbagGeometry = new THREE.SphereGeometry(1, 10, 6);
  const dark = new THREE.MeshStandardMaterial({ color: 0x242a28, roughness: .92 });
  const sceneArt = { wallPieces: 0, doorLeaves: 0, sandbagMaterial: 'burlap',
    grimeDecals: 0, detailedCargo: 0, detailedSandbags: 0, shopAwnings: 0,
    shopNotices: 0, contactPatches: 0, shopSamples: [] };

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

  function makeSurface(x, z, w, d, material, y = -.16, clipRivers = true) {
    // Cut river openings out of terrain and roads, rather than burying water under a full ground plane.
    if (clipRivers && (material === ground || material === road && y < 0)) {
      let rectangles = [{ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }];
      for (const river of RIVERS) {
        rectangles = rectangles.flatMap(rect => {
          const minX = Math.max(rect.minX, river.x - river.width / 2);
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
    return mesh;
  }

  function shellPocks(x, y, z, radius, seed) {
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
          z - .008);
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
      makeSurface((x - w / 2 + other.x - other.width / 2) / 2, z,
        other.x - other.width / 2 - (x - w / 2), d, water, riverLevel),
      makeSurface((other.x + other.width / 2 + x + w / 2) / 2, z,
        x + w / 2 - (other.x + other.width / 2), d, water, riverLevel),
    ] : [makeSurface(x, z, w, d, water, riverLevel)];
    for (const riverSurface of surfaces) {
      riverSurface.userData.nanjingFeature = 'river-water';
      if (w < d && other) {
        riverSurface.geometry.dispose();
        riverSurface.geometry = new THREE.PlaneGeometry(w, d, 1, Math.ceil(d));
        const vertices = riverSurface.geometry.attributes.position;
        for (let index = 0; index < vertices.count; index++) {
          const worldZ = z - vertices.getY(index);
          const distance = Math.max(0, Math.abs(worldZ - other.z) - other.depth / 2);
          const blend = Math.min(1, distance / 12);
          const smooth = blend * blend * (3 - 2 * blend);
          vertices.setZ(index, (SOUTH_RIVER_WATER - riverLevel) * (1 - smooth));
        }
        riverSurface.geometry.computeVertexNormals();
      }
    }
    const bank = 3, addBank = (minX, maxX, minZ, maxZ) => {
      // The two rivers meet here; neither embankment may divide the other waterway.
      const otherRiver = RIVERS.find(river => river.x !== x || river.z !== z);
      if (otherRiver && minX < otherRiver.x + otherRiver.width / 2 &&
        maxX > otherRiver.x - otherRiver.width / 2 &&
        minZ < otherRiver.z + otherRiver.depth / 2 && maxZ > otherRiver.z - otherRiver.depth / 2) {
        if (w > d) {
          if (minX < otherRiver.x - otherRiver.width / 2) {
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
        { minX: x - w / 2, maxX: dockEdge, minZ: z - d / 2, maxZ: z + d / 2, height: 2, water: true },
        { minX: dockEdge, maxX: x + w / 2, minZ: z - d / 2, maxZ: NANJING_DOCK.z - 10, height: 2, water: true },
        { minX: dockEdge, maxX: x + w / 2, minZ: NANJING_DOCK.z + 10, maxZ: z + d / 2, height: 2, water: true },
      );
      for (const edge of [-1, 1]) {
        const bankX = x + edge * (w / 2 - bank / 2);
        const gaps = edge === 1 ? [{ min: NANJING_DOCK.z - 10, max: NANJING_DOCK.z + 10 }] : [];
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
        { depth: .12, bevelEnabled: false, curveSegments: 4 }), stone);
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

  function intersectsWallPassage(x, halfWidth) {
    return NANJING_WALL_WALKS.some(walk =>
      Math.abs(x - (walk.minX + walk.maxX) / 2) < halfWidth + .8);
  }

  function makeGate(z, main = false) {
    const height = main ? NANJING_GATE_HEIGHT : NANJING_RAMPART_HEIGHT;
    const wallHeight = Math.max(height, WALL_WALK.height);
    const width = GATE_WIDTH;
    const opening = NANJING_GATE_TUNNEL.width;
    const depth = NANJING_GATE_TUNNEL.depth;
    for (const side of [-1, 1]) {
      const segmentWidth = width / 2 - opening / 2;
      obstacles.push({ minX: side < 0 ? -width / 2 : opening / 2,
        maxX: side < 0 ? -opening / 2 : width / 2,
        minZ: z - depth / 2, maxZ: z + depth / 2, minY: 0, height: wallHeight });
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
    const geometry = new THREE.ExtrudeGeometry(masonry, { depth, bevelEnabled: false, curveSegments: 24 });
    const uv = geometry.attributes.uv, positions = geometry.attributes.position, normals = geometry.attributes.normal;
    const material = main ? brick : stone, meters = material.userData.metersPerTile ?? 2.4;
    for (let vertex = 0; vertex < uv.count; vertex++) {
      uv.setXY(vertex, (Math.abs(normals.getX(vertex)) > .5 ? positions.getZ(vertex) : positions.getX(vertex)) / meters,
        positions.getY(vertex) / meters);
    }
    const aboveArch = new THREE.Mesh(geometry, material);
    aboveArch.position.set(0, 0, z - depth / 2);
    aboveArch.castShadow = aboveArch.receiveShadow = true;
    scene.add(aboveArch); solids.push(aboveArch);
    obstacles.push({ minX: -opening / 2, maxX: opening / 2, minZ: z - depth / 2,
      maxZ: z + depth / 2, minY: archCrown, height: wallHeight });
    aboveArch.userData.nanjingFeature = 'gate-above-arch-masonry';
    const merlons = [];
    for (let x = -width / 2 + 2 * DETAIL_SCALE; x <= width / 2 - 2 * DETAIL_SCALE; x += 4 * DETAIL_SCALE) {
      if (Math.abs(x) < opening / 2 + 1.5 * DETAIL_SCALE) continue;
      if (intersectsWallPassage(x, 1.35 * DETAIL_SCALE / 2)) continue;
      for (const edge of [-1, 1]) {
        const merlon = addBox(x, wallHeight + .575 * DETAIL_SCALE,
          z + edge * (depth / 2 - .5 * DETAIL_SCALE),
          1.35 * DETAIL_SCALE, 1.15 * DETAIL_SCALE, DETAIL_SCALE, stone, true);
        merlon.userData.nanjingFeature = 'wall-merlon';
        merlons.push(merlon);
      }
    }
    if (main) {
      for (const side of [-1, 1]) {
        const x = side * 25.8 * DETAIL_SCALE;
        for (let notch = -3; notch <= 3; notch += 2) {
          if (intersectsWallPassage(x + notch * DETAIL_SCALE, .9 * DETAIL_SCALE / 2)) continue;
          for (const edge of [-1, 1]) {
            const crenel = addBox(x + notch * DETAIL_SCALE, wallHeight + .25 * DETAIL_SCALE,
              z + edge * 2.85 * DETAIL_SCALE,
              .9 * DETAIL_SCALE, .5 * DETAIL_SCALE, .8 * DETAIL_SCALE, stone, true);
            crenel.userData.nanjingFeature = 'gate-tower-crenel';
          }
        }
      }
      for (let index = 0; index < 22; index++) {
        const rubbleHeight = (.3 + index % 3 * .14) * DETAIL_SCALE;
        const rubble = addBox((-8 + index % 16) * DETAIL_SCALE, rubbleHeight / 2,
          z + (4 + index % 5) * DETAIL_SCALE, (.45 + index % 3 * .15) * DETAIL_SCALE,
          rubbleHeight, (.5 + index % 4 * .12) * DETAIL_SCALE, index % 3 ? brick : stone);
        rubble.rotation.y = index * .73;
        rubble.userData.nanjingFeature = 'gate-rubble';
      }
    }
    return { x: 0, z, width, height: wallHeight, opening, depth, main,
      archstones: arch.archstones.length, merlons: merlons.length };
  }

  makeSurface(0, 0, 216, 216, ground);
  makeSurface(0, 48, 12, 120, road, -.08);
  makeSurface(-43, 10, 56, 4, road, -.07);
  for (const street of cityLayout.streets) {
    for (let index = 1; index < street.points.length; index++) {
      const [ax, az] = street.points[index - 1], [bx, bz] = street.points[index];
      const length = Math.hypot(bx - ax, bz - az);
      const paving = makeSurface((ax + bx) / 2, (az + bz) / 2, street.width, length + .35, road, -.075, false);
      paving.rotation.z = Math.atan2(bx - ax, bz - az);
      paving.userData.nanjingFeature = 'city-lane';
      paving.userData.streetId = street.id;
    }
  }
  makeSurface(-24, 76, 10, 58, road, -.07);
  makeSurface(-12, 38, 24, 8, road, -.06);
  makeRiver(0, 52, 210, 26, [YUHUA_BRIDGE]);
  makeRiver(-84, 0, 24, 300);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xb4c3b4, transparent: true, opacity: .18, depthWrite: false });
  for (let index = 0; index < 72; index++) {
    const ripple = makeSurface(-68 + (index * 17.31 % 164), 40 + (index * 7.73 % 23),
      .5 + index % 5 * .3, .025, rippleMaterial, SOUTH_RIVER_WATER + .025);
    ripple.rotation.z = Math.sin(index * 2.4) * .15;
    ripple.userData.nanjingFeature = 'river-ripple';
  }

  const gateways = STONE_WALLS.map(z => makeGate(z, z === NANJING_GATE_Z));
  const northernWall = addBox(16, 5, -113, 180, 10, 4.4, brick);
  northernWall.userData.nanjingFeature = 'northern-city-wall';
  for (let x = -73; x <= 105; x += 2.4) {
    const merlon = addBox(x, 10.55, -111.2, 1.3, 1.1, .6, brick);
    merlon.userData.nanjingFeature = 'northern-city-wall-merlon';
  }
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
    const length = horizontal ? width : depth;
    for (let offset = 1; offset < length; offset += 2.2) {
      if (breach && bounds.minX + offset > breach.minX - .6 &&
        bounds.minX + offset < breach.maxX + .6) continue;
      const merlon = addBox(horizontal ? bounds.minX + offset : bounds.minX + .4,
        WALL_WALK.height + .4, horizontal ? bounds.maxZ - .4 : bounds.minZ + offset,
        horizontal ? 1.2 : .8, .8, horizontal ? .8 : 1.2, stone, true);
      merlon.userData.nanjingFeature = 'city-wall-merlon';
    }
  }
  const barbicans = [];
  for (const side of [-1, 1]) {
    const x = side * (GATE_WIDTH / 2 - NANJING_RAMPART_THICKNESS / 2);
    const curtainHeight = WALL_WALK.height - .4;
    const curtain = addBox(x, curtainHeight / 2, (NANJING_GATE_NORTH_EDGE + NANJING_GATE_SOUTH_EDGE) / 2, NANJING_RAMPART_THICKNESS,
      curtainHeight, GATE_LENGTH, stone, true, true);
    curtain.userData.nanjingFeature = 'barbican-curtain-wall';
    let startZ = NANJING_GATE_NORTH_EDGE;
    for (const gate of [...gateways, { z: NANJING_GATE_SOUTH_EDGE, depth: 0 }]) {
      const endZ = gate.z - gate.depth / 2;
      if (endZ > startZ) {
        const walk = addBox(x, WALL_WALK.height - .225 * DETAIL_SCALE, (startZ + endZ) / 2,
          NANJING_RAMPART_THICKNESS, .45 * DETAIL_SCALE, endZ - startZ, brick);
        walk.userData.nanjingFeature = 'wall-walk';
      }
      startZ = gate.z + gate.depth / 2;
    }
    for (const z of [-26, -20, -2, 2, 20, 26].map(value => value * DETAIL_SCALE)) {
      if (z < NANJING_GATE_NORTH_EDGE || z > NANJING_GATE_SOUTH_EDGE) continue;
      const merlon = addBox(x + side * 1.8 * DETAIL_SCALE,
        WALL_WALK.height + .5 * DETAIL_SCALE, z,
        1.2 * DETAIL_SCALE, DETAIL_SCALE, 1.6 * DETAIL_SCALE, stone, true);
      merlon.userData.nanjingFeature = 'curtain-merlon';
    }
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
        const block = addBox(buffer.centerX, (bottom + top) / 2, z,
          buffer.width, height, depth, brick, true, true);
        block.userData.nanjingFeature = 'flanking-masonry-core';
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
  const battlements = solids.filter(mesh =>
    ['wall-merlon', 'curtain-merlon', 'gate-tower-crenel', 'city-wall-merlon'].includes(mesh.userData.nanjingFeature));
  const battlementBrick = brick.clone();
  battlementBrick.onBeforeCompile = brick.onBeforeCompile;
  battlementBrick.customProgramCacheKey = brick.customProgramCacheKey;
  battlementBrick.vertexColors = true;
  for (const [index, mesh] of battlements.entries()) {
    const { x: width, y: height, z: depth } = mesh.scale;
    const geometry = new RoundedBoxGeometry(width, height, depth, 1, .045);
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
    const colors = [], tint = new THREE.Color();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const px = positions.getX(vertex), py = positions.getY(vertex), pz = positions.getZ(vertex);
      const corner = px > width * .25 && pz > depth * .25 && py > height * .25;
      const chip = corner ? .025 + index % 3 * .012 : 0;
      positions.setXYZ(vertex, px / width, (Math.min(py, height / 2 - .11) - chip) / height, pz / depth);
      uv.setXY(vertex, (Math.abs(normals.getX(vertex)) > .5 ? pz : px) / .65,
        (Math.abs(normals.getY(vertex)) > .5 ? pz : py) / .65);
      const shade = .8 + index % 5 * .025 + (py / height + .5) * .08;
      tint.setRGB(shade, shade * .98, shade * .93);
      colors.push(tint.r, tint.g, tint.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.material = battlementBrick;
    mesh.userData.battlementFinish = 'weathered-beveled-brick';
    const coping = addBox(mesh.position.x, mesh.position.y + height / 2 - .05,
      mesh.position.z, width, .1, depth, stone);
    coping.userData.nanjingFeature = 'battlement-coping';
  }
  const roofMaterial = surface('tiles', 0x89918c, 1.4);
  roofMaterial.side = THREE.DoubleSide;
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
  for (const [index, [x, z, footprintWidth, footprintDepth, floors, facing]] of residentialLots.entries()) {
    const w = facing % 2 ? footprintDepth : footprintWidth;
    const d = facing % 2 ? footprintWidth : footprintDepth;
    const firstSolid = solids.length, firstObstacle = obstacles.length, firstImpact = impactGeometry.length;
    const h = floors * 2.7;
    const damaged = z < 10 && (index % 3 !== 0 || z >= -26 && index % 4 === 0);
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
    let roofGeometry = createRoofGeometry(w + overhang * 2, d + .8, roofRise,
      roofMaterial.userData.metersPerTile ?? 1.4);
    if (damaged) {
      const fragments = [];
      for (let strip = 0; strip < 12; strip++) {
        const fragment = createRoofGeometry(w + overhang * 2, (d + .8) / 12, roofRise,
          roofMaterial.userData.metersPerTile ?? 1.4);
        fragment.translate(0, 0, -(d + .8) / 2 + (strip + .5) * (d + .8) / 12);
        const positions = fragment.attributes.position, indices = [];
        for (let vertex = 0; vertex < positions.count; vertex++) {
          fragment.attributes.uv.setY(vertex, positions.getZ(vertex) / (roofMaterial.userData.metersPerTile ?? 1.4));
        }
        for (let vertex = 0; vertex < positions.count; vertex += 3) {
          const cx = (positions.getX(vertex) + positions.getX(vertex + 1) + positions.getX(vertex + 2)) / 3;
          const brokenEdge = -w * (.03 + .045 * (1 + Math.sin(strip * 2.7 + index)));
          if (cx > brokenEdge) continue;
          indices.push(vertex, vertex + 1, vertex + 2);
        }
        fragment.setIndex(indices);
        const expanded = fragment.toNonIndexed();
        fragments.push(expanded);
        fragment.dispose();
      }
      roofGeometry.dispose();
      roofGeometry = mergeGeometries(fragments);
      for (const fragment of fragments) fragment.dispose();
    }
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
      damaged, use: z < -30 && index % 2 === 0 && !damaged ? 'shop' : 'home' });
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
    if (z < -30 && index % 2 === 0 && !damaged) {
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
  function placeForwardSandbag(x, z, row, id, yaw = 0, feature = 'forward-sandbag') {
    let seed = 2166136261;
    for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const variation = shift => ((seed >>> shift) & 31) / 31 - .5;
    const visual = new THREE.Mesh(detailedSandbagGeometry, burlap);
    visual.position.set(x + variation(0) * .07, .21 + row * .36 + variation(5) * .035,
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
      minY: 0, height: bounds.max.y });
  }
  function addForwardDefense(centerX, z, label, count = 10, armBags = 4, yaw = 0, defenses = forwardDefenses) {
    const spacing = .88;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const point = (x, along) => ({ x: centerX + x * c + along * s, z: z - x * s + along * c });
    const place = (x, along, row, id) => {
      const position = point(x, along);
      placeForwardSandbag(position.x, position.z, row, id, yaw,
        defenses === forwardDefenses ? 'forward-sandbag' : 'dock-sandbag');
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
  const dockDefenses = [];
  addForwardDefense(-66.5, -92, 'dock-north', 5, 2, Math.PI, dockDefenses);
  addForwardDefense(-65, -68, 'dock-south', 5, 2, 0, dockDefenses);
  addForwardDefense(-54, -85, 'dock-east-north', 4, 2, Math.PI / 2, dockDefenses);
  addForwardDefense(-54, -74, 'dock-east-south', 4, 2, Math.PI / 2, dockDefenses);
  const dock = addBox(NANJING_DOCK.x, .18, NANJING_DOCK.z, 14, .36, 20, timber);
  dock.receiveShadow = true;
  const rampGeometry = new THREE.BufferGeometry();
  rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -59, .36, -90, -57.5, 0, -90, -59, .36, -70,
    -57.5, 0, -90, -57.5, 0, -70, -59, .36, -70,
    -73, 0, -91.5, -59, 0, -91.5, -73, .36, -90,
    -59, 0, -91.5, -59, .36, -90, -73, .36, -90,
    -73, .36, -70, -59, .36, -70, -73, 0, -68.5,
    -59, .36, -70, -59, 0, -68.5, -73, 0, -68.5,
    -59, .36, -90, -59, 0, -91.5, -57.5, 0, -91.5,
    -59, .36, -90, -57.5, 0, -91.5, -57.5, 0, -90,
    -59, .36, -70, -57.5, 0, -68.5, -59, 0, -68.5,
    -59, .36, -70, -57.5, 0, -70, -57.5, 0, -68.5,
  ], 3));
  rampGeometry.computeVertexNormals();
  const rampMaterial = timber.clone(); rampMaterial.side = THREE.DoubleSide;
  const dockRamp = new THREE.Mesh(rampGeometry, rampMaterial);
  scene.add(dockRamp); solids.push(dockRamp);
  for (let index = 0; index < 5; index++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.68, 4.4, 4, 8), timber);
    hull.rotation.z = Math.PI / 2;
    hull.scale.set(1, 1.1, 1);
    hull.position.y = .42;
    boat.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.9, .12, 1.25), timber);
    deck.position.y = 1.02;
    boat.add(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.9, .35, .1), timber);
      rail.position.set(0, 1.2, side * .65);
      boat.add(rail);
    }
    const oar = new THREE.Mesh(new THREE.BoxGeometry(4.1, .07, .08), stone);
    oar.rotation.y = Math.PI / 2;
    oar.position.set(2.3, 1.1, .55);
    boat.add(oar);
    boat.position.set(NANJING_DOCK.ferryX, .05, NANJING_DOCK.z - 6 + index * 3);
    oar.visible = false;
    boat.userData = { ferryId: index, passengers: [], boarding: null, oar, state: 'docked', originZ: boat.position.z };
    const gangplank = addBox(-73.2, .75, boat.position.z, 2.4, .12, .8, timber);
    gangplank.rotation.z = -.3;
    gangplank.userData.nanjingFeature = 'ferry-gangplank';
    boat.userData.gangplank = gangplank;
    scene.add(boat);
    ferries.push(boat);
  }

  const civilianCharacters = createCivilianCharacterFactory();
  const civilianHomes = residentialBuildings.filter(house => house.floors === 1 && house.z < 0 && !house.damaged);
  for (let index = 0; index < NANJING_CIVILIAN_COUNT; index++) {
    const ageGroup = index % 10 === 0 ? 'child' : index % 10 === 1 ? 'elderly' : 'adult';
    const presentation = (ageGroup === 'adult' ? index : Math.floor(index / 10)) % 2 === 0 ? 'woman' : 'man';
    const carrying = ageGroup === 'adult' && index % 17 === 7 ? 'child'
      : ageGroup !== 'child' && index % 12 === 5 ? 'luggage' : 'none';
    const group = civilianCharacters.create(index, ageGroup, presentation, carrying);
    const home = civilianHomes[index >= 60 && index < 70
      ? Math.floor((index - 60) * civilianHomes.length / 10) : index % civilianHomes.length];
    const start = index < 60 ? nanjingOpeningCivilianStart(index) : home.exit;
    const startX = start.x;
    const startZ = start.z;
    group.position.set(startX, 0, startZ);
    group.visible = false;
    Object.assign(group.userData, { civilianId: index, homeId: home.id, startX, startZ,
      openingWave: index < 60, openingStraggler: index >= 48 && index < 60,
      withdrawalWave: index >= 60, releaseAt: index >= 60 ? Infinity : nanjingOpeningCivilianReleaseAt(index),
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
  const trees = [];
  const treeBark = Object.fromEntries(Object.keys(WOODLAND_SPECIES).map(species => {
    const material = surface(`bark-${species}`);
    material.vertexColors = true;
    return [species, material];
  }));
  const treeLeaves = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .92 });
  treeLeaves.userData.spatialBatch = true;
  const candidates = [
    ...[-100, -54, -34, -14, 8, 28, 76].map(z => [-67, z]),
    ...[-81, -61, -41, -21, 9].flatMap(z => [-56, -43, -33, -23, -13, 17, 29, 41, 51, 61, 83, 95].map(x => [x, z])),
    ...[-49, -34, 18, 38, 58, 78, 96].map(x => [x, 34]),
  ];
  for (const [index, [baseX, baseZ]] of candidates.entries()) {
    const x = baseX + Math.sin(index * 2.71) * .32, z = baseZ + Math.cos(index * 1.79) * .3;
    if (trees.length >= 40 || Math.abs(x) < 7 || Math.abs(z + 60) < 3 ||
      x < -39 && z < -64 && z > -97 || Math.abs(x + 24) < 9 && z > 25 ||
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
      age: index % 7 === 0 ? 'sapling' : 'adult', dead: index % 13 === 4,
      sparse: index % 5 === 0, heading: index * 2.39 };
    const geometry = woodlandTreeGeometry(tree);
    for (const [part, material] of [[geometry.bark, treeBark[species]], [geometry.foliage, treeLeaves]]) {
      if (!part) continue;
      const mesh = new THREE.Mesh(part, material);
      mesh.position.set(x, -.16, z);
      mesh.castShadow = material !== treeLeaves;
      mesh.receiveShadow = true;
      mesh.userData.nanjingFeature = 'city-tree';
      mesh.userData.keepUV = true;
      scene.add(mesh); solids.push(mesh);
    }
    obstacles.push({ minX: x - tree.radius, maxX: x + tree.radius,
      minZ: z - tree.radius, maxZ: z + tree.radius, height: height * .8,
      circular: true, cx: x, cz: z, radius: tree.radius });
    trees.push(tree);
  }
  sceneArt.woodland = { trees: trees.length, leafStyle: 'individual-folded-leaves',
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
  const waitingPlaces = placeCivilianWaitingSlots(point =>
    !circleBlocked(point.x, point.z, .45, civilianNavigationObstacles));
  const homeRoutes = new Map();
  const routeSegments = new Map();
  for (const civilian of civilians) {
    const data = civilian.userData;
    data.waitingSlot = waitingPlaces[data.civilianId];
    if (!homeRoutes.has(data.civilianId)) {
      const start = { x: data.startX, z: data.startZ };
      const entry = { x: -61, z: data.waitingSlot.z };
      const stops = data.civilianId >= 60
        ? [{ x: -37, z: -62 }, data.waitingSlot]
        : [{ x: -24, z: 31 }, { x: 0, z: 24 }, { x: 0, z: 15 },
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
        movementObstacles: obstacles.filter(obstacle => (obstacle.height ?? Infinity) > .24),
        initialWaypoint, initialPosition: initialWaypoint ? route[initialWaypoint - 1] : inside,
        initialDelay: initialWaypoint ? 0 : (data.civilianId - 60) * 1.3 };
      resetCivilianStreetLife(civilian);
    }
  }
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
  function elevatedPath(start, goal) {
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
  const groundSurface = (x, z) => Math.abs(z - 52) < 13 || Math.abs(x + 84) < 12
    ? 'earth' : Math.abs(x) < 6 || Math.abs(x + 40) < 30 && Math.abs(z) < 6 ? 'stone' : 'earth';
  const staticRendering = batchStaticScene(scene, residentialMeshes);
  sceneArt.staticRendering = staticRendering;
  return {
    solids, obstacles, smoke, flags, boxGeometry, groundSurface, groundHeight, walkHeight,
    moveInfantry: moveNanjingInfantry, elevatedPath, staticRendering,
    bridgeSurfaces: { deck: 0, northRamp: 0, southRamp: 0 },
    riverSurfaces: { water: SOUTH_RIVER_WATER, southBank: 0, northBank: 0, street: 0 },
    armorObstacles: obstacles,
    town, outskirts: { buildings: [], hills: [] }, visibility: {}, doorSystem, sceneArt,
    staticDamage: { craters: [], ruinedShops: [], wrecks: [] },
    ferries, civilians, civilianQueue, civilianNavigate, civilianNavigationObstacles, aircraft, objectives: NANJING_OBJECTIVES, impactHeight,
    landmarks: {
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
      forwardDefenses,
      dockDefenses,
      rivers: RIVERS,
      trees,
      cityStreets: cityLayout.streets,
      residentialBuildings,
      northernBackdrop,
      primaryAssaultRoute: 'yuhua-road-bridge-through-jubaomen',
      wallWalk: WALL_WALK,
      wallWalks: NANJING_WALL_WALKS,
      wallRamps: NANJING_WALL_RAMPS,
      wallStair: WALL_STAIR,
      soldierCave: cave,
      soldierCaves: NANJING_SOLDIER_CAVES,
    },
    resetCampaign() {
      civilianQueue.length = 0;
      for (const civilian of civilians) {
        civilian.removeFromParent();
        scene.add(civilian);
        const data = civilian.userData;
        civilian.position.set(data.startX, 0, data.startZ);
        civilian.rotation.set(0, 0, 0);
        for (const limb of [...civilian.civilianArms, ...civilian.civilianLegs]) limb.rotation.set(0, 0, 0);
        civilian.civilianTorso.rotation.set(0, 0, 0);
        civilian.civilianHead.rotation.set(0, 0, 0);
        civilian.visible = false;
        Object.assign(data, { waypoint: 0, arrived: false, dead: false, health: 100, active: false, exposure: 0,
          panicked: false, panicStartedAt: null, crowdTarget: null, crowdPath: null, crowdStalled: 0,
          threatResponse: null, escapeMotion: null, escapeMode: null,
          crowdDetourPoint: null, crowdPathStalled: 0, crowdPathBestDistance: Infinity,
          boarding: false, evacuated: false, deadAt: null,
          streetEvacuating: false, route: data.homeRoute,
          releaseAt: data.withdrawalWave ? Infinity : nanjingOpeningCivilianReleaseAt(data.civilianId) });
        for (const bone of civilian.civilianSkin.skeleton.bones) bone.rotation.set(0, 0, 0);
        civilian.civilianSkin.joints.root.position.y = 0;
        resetCivilianStreetLife(civilian);
      }
      for (const ferry of ferries) {
        ferry.userData.passengers = [];
        ferry.userData.boarding = null;
        ferry.userData.oar.visible = false;
        ferry.userData.gangplank.visible = true;
        ferry.userData.state = 'docked';
        ferry.position.set(NANJING_DOCK.ferryX, .05, ferry.userData.originZ);
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
