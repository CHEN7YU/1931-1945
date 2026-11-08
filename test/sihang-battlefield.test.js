import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { circleBlocked } from '../src/core.js';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import {
  SIHANG_WAREHOUSE as W, SIHANG_RIVER, SIHANG_BRIDGE, SIHANG_CAPTURE_AREA,
  SIHANG_DEMOLITION_POINT, SIHANG_EVACUATION, SIHANG_DEFENSE_POSTS,
  SIHANG_SQUAD_ORIGINS, SIHANG_ENEMY_APPROACHES, SIHANG_TANK_ORIGINS, SIHANG_STAIR_ROUTES,
  sihangRiverBounds, sihangSouthBank, SIHANG_RESERVED_LANES, SIHANG_LEVELS,
  SIHANG_STAIRWELLS, sihangStairHeight,
  sihangBridgePoint, sihangBridgeContains, sihangBridgeCoordinates,
} from '../src/sihang-layout.js';

let scene, world;
const point = p => new THREE.Vector3(p.x, p.y ?? 0, p.z);
const close = (actual, expected, message, tolerance = .025) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} != ${expected}`);

function follow(start, goal, route = world.elevatedPath(start, goal)) {
  assert.ok(route.length, `No route ${JSON.stringify(start)} -> ${JSON.stringify(goal)}`);
  const feet = point(start);
  const heights = new Set([Math.round(feet.y * 10) / 10]);
  for (const waypoint of route) {
    const distance = Math.hypot(waypoint.x - feet.x, waypoint.z - feet.z);
    const steps = Math.max(1, Math.ceil(distance / .11));
    const dx = (waypoint.x - feet.x) / steps, dz = (waypoint.z - feet.z) / steps;
    for (let i = 0; i < steps; i++) {
      const oldY = feet.y;
      world.moveInfantry(feet, dx, dz, .42);
      assert.ok(Math.abs(feet.y - oldY) <= .26, 'No teleport or unsupported vertical jump');
      assert.equal(world.isDeepWater(feet.x, feet.z), false, 'Route never wades through the river');
      assert.equal(circleBlocked(feet.x, feet.z, .41,
        world.obstacles.filter(o => !o.walkable || o.height > feet.y + .25), feet.y), false,
      `Route intersects a body-height collider at ${feet.toArray()}`);
      heights.add(Math.round(feet.y * 10) / 10);
    }
    assert.ok(Math.hypot(feet.x - waypoint.x, feet.z - waypoint.z) < .035,
      `Stalled at ${feet.toArray()} before ${JSON.stringify(waypoint)}`);
    close(feet.y, waypoint.y, 'Waypoint support', .16);
  }
  close(feet.x, goal.x, 'Final x'); close(feet.z, goal.z, 'Final z');
  close(feet.y, goal.y ?? 0, 'Final y');
  return { feet, heights, route };
}

function horizontalHits(x, y, z, direction, length) {
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(...direction), 0, length);
  return ray.intersectObjects(world.solids, false);
}

describe('independent Sihang Warehouse battlefield', () => {
  before(() => {
    scene = new THREE.Scene();
    world = makeSihangBattlefield(scene, (kind, color) => {
      assert.ok(['brick', 'plaster', 'tiles', 'paving', 'earth', 'timber'].includes(kind), 'Supported shared surface');
      return new THREE.MeshStandardMaterial({ color });
    });
  });
  beforeEach(() => world.resetCampaign());

  it('exports the coordinate contract and a complete standalone world', () => {
    assert.equal(W.width, 64); assert.equal(W.depth, 34);
    assert.equal(W.floorHeight, 8.4); assert.equal(W.floors, 3); assert.equal(W.roofY, 25.2);
    assert.deepEqual(SIHANG_RIVER, { northZ: 8, southZ: 40, waterY: -1 });
    assert.deepEqual(SIHANG_BRIDGE, { name: '西藏路桥', x: 83, z: -22, width: 8,
      northX: 76, southX: 90, northZ: -28, southZ: -16, length: Math.hypot(14, 12) });
    assert.equal(SIHANG_CAPTURE_AREA.maxY, 2.4);
    assert.deepEqual(SIHANG_DEMOLITION_POINT, { x: 0, y: 0, z: -43.5 });
    assert.equal(SIHANG_EVACUATION.southZ, -14);
    for (const key of ['solids', 'obstacles', 'smoke', 'flags', 'armorObstacles', 'civilians', 'civilianVisuals'])
      assert.ok(Array.isArray(world[key]), key);
    for (const key of ['groundSurface', 'groundHeight', 'walkHeight', 'moveInfantry', 'elevatedPath',
      'impactHeight', 'isDeepWater', 'resetCampaign', 'updateCivilians', 'ruinWarehouse'])
      assert.equal(typeof world[key], 'function', key);
    for (const key of ['pieces', 'buildings', 'covers', 'streets', 'fortifications', 'passages'])
      assert.ok(Array.isArray(world.town[key]), `town.${key}`);
    assert.deepEqual(world.outskirts, { buildings: [], hills: [] });
    assert.deepEqual(world.staticDamage, { craters: [], ruinedShops: [], wrecks: [] });
    for (const method of ['reset', 'update', 'focus', 'openAhead', 'interact'])
      assert.equal(typeof world.doorSystem[method], 'function', `doorSystem.${method}`);
    assert.ok(world.doorSystem.navigationObstacles.length);
    assert.ok(world.doorSystem.doors.length >= 10, 'Real accessible residential doors');
    assert.equal(world.flags.length, 1, 'Only the objective marker is recoloured by capture logic');
    assert.ok(world.flags[0].material.color.isColor);
    assert.equal(world.landmarks.roofFlag.name, 'sihang-roof-roc-flag');
    assert.ok(world.boxGeometry.isBufferGeometry);
    assert.ok(world.solids.every(mesh => mesh.isMesh), 'Solids are actual visible raycast meshes');
    assert.ok(world.obstacles.every(o => Number.isFinite(o.height)), 'All collision obstacles have vertical bounds');
  });

  it('fits all 44 allies on supported second-floor ground without walls or stair holes', () => {
    const spawns = SIHANG_SQUAD_ORIGINS.flatMap(origin =>
      Array.from({ length: 11 }, (_, i) => ({
        x: origin.x + (i % 4 - 1.5) * 1.6,
        z: origin.z + (Math.floor(i / 4) - 1) * 1.6, y: origin.y,
      })));
    assert.equal(spawns.length, 44);
    scene.updateMatrixWorld(true);
    for (const p of spawns) {
      close(world.walkHeight(p.x, p.z, p.y), W.floorHeight, 'Spawn floor support');
      assert.equal(circleBlocked(p.x, p.z, .45, world.obstacles, p.y), false, `Spawn collides: ${JSON.stringify(p)}`);
      const ray = new THREE.Raycaster(point({ ...p, y: W.floorHeight + .1 }), new THREE.Vector3(0, -1, 0), 0, .3);
      const hit = ray.intersectObjects(world.solids, false)[0];
      assert.ok(hit, 'Visible floor supports spawn feet');
      close(hit.point.y, W.floorHeight, 'Physical second-floor mesh');
    }
    for (let i = 0; i < spawns.length; i++) for (let j = i + 1; j < spawns.length; j++)
      assert.ok(Math.hypot(spawns[i].x - spawns[j].x, spawns[i].z - spawns[j].z) >= 1.25);
  });

  it('keeps three northern spawn areas, armour corridors and the demolition face clear', () => {
    for (const spawn of [...SIHANG_ENEMY_APPROACHES, ...SIHANG_TANK_ORIGINS, SIHANG_DEMOLITION_POINT])
      assert.equal(circleBlocked(spawn.x, spawn.z, 1.2, world.obstacles), false);
    for (const x of [-70, 70]) {
      const tank = new THREE.Vector3(x, 0, -90);
      world.moveInfantry(tank, 0, 65, 2.1, world.armorObstacles, 2.6);
      close(tank.z, -25, 'Wide unblocked tank approach');
      world.moveInfantry(tank, x < 0 ? 30 : -36, 0, 2.1, world.armorObstacles, 2.6);
      close(tank.x, x < 0 ? -40 : 34, 'Tank can reach the warehouse flank');
    }
  });

  it('walks closed 24-riser flights and U-turn landings in all three stairwells on every storey', () => {
    assert.equal(SIHANG_STAIRWELLS.length, 3);
    assert.equal(SIHANG_STAIR_ROUTES.length, 9);
    for (const route of SIHANG_STAIR_ROUTES) {
      const up = follow(route.bottom, route.top);
      assert.ok(up.heights.size >= 49, 'All 48 actual risers plus floor-level support');
      assert.ok(up.route.some(p => p.z > -25.8 && p.y === route.landing.height), 'Uses the intermediate landing');
      assert.ok(up.route.some(p => p.x < route.x) && up.route.some(p => p.x > route.x), 'Switches flight lanes');
      for (const flight of route.flights) {
        assert.equal(flight.steps, 24);
        close(Math.abs(flight.end.z - flight.start.z), 7.2, 'Compact flight run');
        close((flight.end.y - flight.start.y) / flight.steps, .175, 'Human-scale riser');
      }
      follow(route.top, route.bottom);
    }
    const result = follow({ x: 0, y: 0, z: -60 }, { x: 0, y: W.roofY, z: -12 });
    for (const y of SIHANG_LEVELS) assert.ok(result.heights.has(y));
    follow({ x: 0, y: W.roofY, z: -12 }, { x: -78, y: 0, z: -88 });
  });

  it('replans mid-flight and on turn landings without vertical jumps, shortcuts or skipped storeys', () => {
    const goal = { x: SIHANG_EVACUATION.x, y: 0, z: SIHANG_EVACUATION.z };
    for (const route of SIHANG_STAIR_ROUTES) {
      for (const flight of route.flights) {
        const z = (flight.start.z + flight.end.z) / 2;
        const start = { x: flight.start.x, y: sihangStairHeight(flight, z), z };
        follow(start, goal);
        follow(route.bottom, start);
      }
      follow({ x: route.x, y: route.landing.height, z: -24.8 }, goal);
    }
  });

  it('rejoins capsule-safe flight lanes and artificial landing collars in three shafts', () => {
    const goal = { x: SIHANG_EVACUATION.x, y: 0, z: SIHANG_EVACUATION.z };
    for (const route of SIHANG_STAIR_ROUTES) {
      for (const flight of route.flights) for (const offset of [-.65, .65]) {
        const z = -29.4, y = sihangStairHeight(flight, z);
        const start = { x: flight.start.x + offset, y, z };
        const path = world.elevatedPath(start, goal);
        assert.ok(path.length);
        close(path[0].y, start.y, 'Lateral rejoin keeps tread support');
        follow(start, goal, path);
      }
      follow({ x: route.top.x, y: route.top.y, z: -33.55 }, goal);
    }
    assert.deepEqual(world.elevatedPath({ x: -12, y: 0, z: -42 }, goal), [],
      'A real masonry obstruction cannot be bypassed by a projected-start fallback');
  });

  it('has real floor cutouts, not transparent floors spanning the stairs', () => {
    scene.updateMatrixWorld(true);
    for (const shaft of SIHANG_STAIRWELLS) {
      const route = SIHANG_STAIR_ROUTES.find(r => r.stairId === shaft.id && r.floor === 2);
      const flight = route.flights[1], z = -29.29;
      const ray = new THREE.Raycaster(new THREE.Vector3(flight.start.x, W.roofY + .2, z), new THREE.Vector3(0, -1, 0), 0, 5);
      const hits = ray.intersectObjects(world.solids, false);
      assert.ok(hits.length, 'Top flight exists below the roof cutout');
      close(hits[0].point.y, sihangStairHeight(flight, z), 'Visible riser supports the analytic foot height', .005);
      assert.ok(hits[0].point.y < W.roofY - 1, 'Roof slab does not cap the stairwell');
      const direction = shaft.x === -32 ? -1 : 1;
      const feet = new THREE.Vector3(shaft.x - direction * 3.6, W.floorHeight, z);
      world.moveInfantry(feet, direction * 3.6, 0, .42);
      assert.ok(Math.abs(feet.x - shaft.x) > 2.5, 'Cannot side-step into an unsupported shaft void');
    }
  });

  it('blocks low stair undersides while permitting real headroom beneath higher treads', () => {
    const shaft = SIHANG_STAIRWELLS[1], flight = SIHANG_STAIR_ROUTES.find(r => r.stairId === shaft.id && r.floor === 0).flights[0];
    const low = new THREE.Vector3(shaft.minX - .6, 0, -31.2);
    world.moveInfantry(low, 2.1, 0, .42);
    assert.ok(low.x < flight.minX, 'A body cannot enter a low concrete stair underside');
    const high = new THREE.Vector3(shaft.minX - .6, 0, -28);
    world.moveInfantry(high, 2.1, 0, .42);
    close(high.x, flight.start.x, 'High flight has usable ground-floor headroom');
    close(high.y, 0, 'Walking underneath does not snap upward onto the staircase');
    assert.equal(world.stairAt(null), null);
    assert.equal(world.stairAt({ x: 0, y: Infinity, z: 0 }), null);
    assert.throws(() => world.walkHeight(0, -20, NaN), RangeError);
    assert.throws(() => world.elevatedPath({ x: 0, y: 0, z: Infinity }, { x: 48, y: 0, z: 48 }), RangeError);
    assert.throws(() => sihangStairHeight(flight, NaN), RangeError);
  });

  it('keeps solid masonry, local irregular breaches, the north gate and actual defense apertures', () => {
    for (const y of SIHANG_LEVELS.slice(0, 3).map(y => y + 1.65))
      assert.ok(horizontalHits(-35, y, -46, [0, 0, 1], 6).length, 'Strong uninterrupted masonry corners');
    const holes = world.landmarks.warehouse.breaches;
    assert.equal(holes.filter(h => h.blown).length, 3, 'Only selected panels have shell breaches');
    for (const hole of holes) {
      const west = hole.x === W.minX, east = hole.x === W.maxX;
      const direction = hole.axis === 'z' ? [west ? 1 : -1, 0, 0] : [0, 0, hole.z === W.minZ ? 1 : -1];
      const startX = hole.axis === 'z' ? hole.x + (west ? -2 : 2) : hole.x;
      const startZ = hole.axis === 'x' ? hole.z + (hole.z === W.minZ ? -2 : 2) : hole.z;
      assert.equal(horizontalHits(startX, hole.y, startZ, direction, 3).length, 0, `Real aperture ${hole.id}`);
      assert.equal(east || west || hole.axis === 'x', true);
    }
    for (const x of [W.minX, W.maxX]) for (const z of [-41, -9])
      assert.ok(horizontalHits(x + (x === W.minX ? -2 : 2), 6, z,
        [x === W.minX ? 1 : -1, 0, 0], 3).length, 'Intact corners support the shell');
    assert.equal(SIHANG_DEFENSE_POSTS.length, 22);
    for (const p of SIHANG_DEFENSE_POSTS) {
      assert.equal(circleBlocked(p.x, p.z, .42, world.obstacles, p.y), false);
      close(world.walkHeight(p.x, p.z, p.y), W.floorHeight, 'Defense floor');
      assert.equal(horizontalHits(p.x, p.y + 1.5, p.z,
        p.facade === 'north' ? [0, 0, -1] : [1, 0, 0], 2).length, 0, 'Defense post fires through an actual opening');
    }
    const feet = new THREE.Vector3(-20, 0, -46);
    world.moveInfantry(feet, 0, 8, .42);
    close(feet.z, -38, 'The north gate is a genuine walkable entrance');
    const pier = new THREE.Vector3(-12, 0, -46);
    world.moveInfantry(pier, 0, 8, .42);
    assert.ok(pier.z < -42.7, 'Movement respects surviving wall piers');
  });

  it('provides 22 distinct low-sill firing positions with clear downward eye and muzzle rays', () => {
    assert.equal(new Set(SIHANG_DEFENSE_POSTS.map(p => `${p.x},${p.z}`)).size, 22);
    assert.equal(SIHANG_DEFENSE_POSTS.filter(p => p.facade === 'north').length, 16);
    assert.equal(SIHANG_DEFENSE_POSTS.filter(p => p.facade === 'east').length, 6);
    for (const p of SIHANG_DEFENSE_POSTS) {
      const aperture = world.landmarks.warehouse.breaches.find(h => h.id === p.apertureId);
      assert.ok(aperture, `Registered aperture for ${p.id}`);
      assert.equal(p.sillY, W.floorHeight + .8);
      assert.equal(aperture.bottom, p.sillY);
      for (const height of [1.35, 1.6]) {
        const origin = new THREE.Vector3(p.x, p.y + height, p.z);
        const direction = new THREE.Vector3(p.aimProbe.x, p.aimProbe.y, p.aimProbe.z).sub(origin).normalize();
        scene.updateMatrixWorld(true);
        assert.equal(new THREE.Raycaster(origin, direction, 0, 2.5).intersectObjects(world.solids, false).length, 0,
          `${p.id} has a downward ${height === 1.35 ? 'muzzle' : 'eye'} ray through its window`);
      }
      assert.equal(circleBlocked(p.x, p.z, .42, world.obstacles, p.y), false);
      follow({ x: 0, y: W.floorHeight, z: -38 }, p);
    }
  });

  it('adds real partition walls and usable room doors on every warehouse storey', () => {
    assert.equal(world.landmarks.warehouse.partitions.length, 18);
    for (const y of SIHANG_LEVELS.slice(0, 3)) {
      assert.ok(horizontalHits(-8, y + 1.5, -22, [0, 0, 1], 4).length, 'Room wall blocks actual rays');
      assert.equal(horizontalHits(-2, y + 1.5, -22, [0, 0, 1], 4).length, 0, 'Four-metre interior doorway stays open');
      follow({ x: -2, y, z: -22 }, { x: -2, y, z: -18 });
    }
  });

  it('routes second-floor squads onto a smooth arched bridge and the south-bank evacuation area', () => {
    for (const origin of SIHANG_SQUAD_ORIGINS)
      follow(origin, { x: SIHANG_EVACUATION.x, y: 0, z: SIHANG_EVACUATION.z });
    const begin = sihangBridgePoint(-2 / SIHANG_BRIDGE.length), end = sihangBridgePoint(1 + 2 / SIHANG_BRIDGE.length);
    const feet = new THREE.Vector3(begin.x, 0, begin.z);
    const steps = Math.ceil((SIHANG_BRIDGE.length + 4) / .1), dx = (end.x - begin.x) / steps, dz = (end.z - begin.z) / steps;
    let highest = 0;
    scene.updateMatrixWorld(true);
    for (let i = 0; i < steps; i++) {
      world.moveInfantry(feet, dx, dz, .42);
      highest = Math.max(highest, feet.y);
      if (sihangBridgeContains(feet)) {
        const ray = new THREE.Raycaster(new THREE.Vector3(feet.x, feet.y + .05, feet.z), new THREE.Vector3(0, -1, 0), 0, .12);
        const hit = ray.intersectObjects(world.solids, false)[0];
        assert.ok(hit, 'Arched bridge visually supports the feet');
        close(hit.point.y, feet.y, 'Bridge deck vs walking height', .005);
      }
    }
    close(highest, 1.15, 'Bridge has an actual arch');
    close(feet.y, 0, 'Returns smoothly to south street');
    close(feet.x, end.x, 'Crosses the diagonal bridge to its south landing');
    close(feet.z, end.z, 'Crosses to the south');
    follow({ x: end.x, y: 0, z: end.z }, { x: begin.x, y: 0, z: begin.z });
  });

  it('rejects river shortcuts across the full width and routes ground traffic over the only bridge', () => {
    for (const x of [-107, -80, 0, 40, 56, 96, 107]) {
      const bounds = sihangRiverBounds(x);
      assert.equal(world.isDeepWater(x, (bounds.northZ + bounds.southZ) / 2), true);
      const feet = new THREE.Vector3(x, 0, bounds.northZ - 3);
      world.moveInfantry(feet, 0, 35, .42);
      assert.ok(feet.z < bounds.northZ, 'Cannot wade or tunnel through the curved north bank');
      const south = new THREE.Vector3(x, 0, bounds.southZ + 3);
      world.moveInfantry(south, 0, -35, .42);
      assert.ok(south.z > bounds.southZ, 'Cannot wade from the curved south bank either');
    }
    const center = sihangBridgePoint(.5);
    assert.equal(world.isDeepWater(center.x, center.z), false);
    assert.equal(world.impactHeight(0, 20), -1);
    const path = follow({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 42 });
    assert.ok(path.route.some(p => sihangBridgeContains(p)), 'Navigation uses the actual diagonal bridge');
    const edge = new THREE.Vector3(center.x, 1.15, center.z);
    const sideways = sihangBridgePoint(.5, -15);
    world.moveInfantry(edge, sideways.x - center.x, sideways.z - center.z, .42);
    assert.ok(Math.abs(sihangBridgeCoordinates(edge).across) <= SIHANG_BRIDGE.width / 2 - .35,
      'Real diagonal bridge railing blocks a sideways river exit');
  });

  it('keeps 36 varied, animated skinned civilians on actual south-bank routes', () => {
    assert.equal(world.civilians.length, 36);
    const ages = new Set(), presentations = new Set();
    const enteredShops = new Set();
    const starts = world.civilians.map(p => p.position.clone());
    for (const person of world.civilians) {
      ages.add(person.userData.ageGroup); presentations.add(person.userData.presentation);
      assert.ok(person.civilianSkin.mesh.isSkinnedMesh);
      assert.ok(person.userData.route.every(p => sihangSouthBank(p, 3)));
    }
    assert.equal(ages.size, 3); assert.equal(presentations.size, 2);
    for (let tick = 0; tick < 300; tick++) {
      world.doorSystem.update(.25, world.civilians.map(person => ({ ...person.position, radius: .27 })));
      world.updateCivilians(.25, tick * .25);
      for (const person of world.civilians) {
        assert.ok(sihangSouthBank(person.position, 3), 'Civilian never crosses the curved river');
        assert.equal(circleBlocked(person.position.x, person.position.z, .26, world.obstacles), false,
          `Civilian ${person.userData.civilianId} at ${person.position.toArray()} intersects ` +
          JSON.stringify(world.obstacles.filter(obstacle => circleBlocked(person.position.x, person.position.z, .26, [obstacle]))));
        if (person.position.z > 58) enteredShops.add(person.userData.civilianId);
      }
    }
    assert.ok(world.civilians.slice(24).some((p, i) => p.position.distanceTo(starts[i + 24]) > 1),
      'Residents actually walk rather than representing fictional routes');
    assert.ok(enteredShops.size >= 8, 'Residents can enter shop interiors');
    for (let i = 0; i < 24; i++) close(world.civilians[i].position.distanceTo(starts[i]), 0, 'Spectators stay at the rail');
  });

  it('uses preprepared demolition visuals and restores dynamic state without regeneration or duplicate colliders', () => {
    const normalSolids = world.solids.length, normalObstacles = world.obstacles.length;
    const meshes = [];
    scene.traverse(object => { if (object.isMesh) meshes.push(object); });
    const geometries = new Set(meshes.map(mesh => mesh.geometry));
    const warehouse = world.landmarks.warehouse;
    for (let cycle = 0; cycle < 3; cycle++) {
      world.ruinWarehouse(); world.ruinWarehouse();
      assert.equal(world.warehouseRuined, true);
      assert.equal(warehouse.intact.visible, false); assert.equal(warehouse.rubble.visible, true);
      assert.equal(world.walkHeight(10, -25, W.roofY), 0);
      assert.equal(horizontalHits(-35, W.floorHeight + 1.65, -46, [0, 0, 1], 6).length, 0, 'No invisible standing shell');
      assert.deepEqual(world.elevatedPath({ x: 0, y: W.roofY, z: -12 }, { x: 0, y: 0, z: -60 }), []);
      world.civilians[0].userData.dead = true; world.civilians[0].visible = false;
      world.civilians[0].position.set(0, -1, 20);
      world.flags[0].material.color.setHex(0xff0000);
      world.resetCampaign();
      assert.equal(world.warehouseRuined, false);
      assert.equal(warehouse.intact.visible, true); assert.equal(warehouse.rubble.visible, false);
      assert.equal(world.solids.length, normalSolids); assert.equal(world.obstacles.length, normalObstacles);
      assert.equal(new Set(world.obstacles).size, normalObstacles);
      assert.equal(world.civilians[0].userData.dead, false); assert.equal(world.civilians[0].visible, true);
      assert.ok(sihangSouthBank(world.civilians[0].position, 3));
      assert.equal(world.flags[0].material.color.getHex(), 0x557ca5);
      assert.ok(horizontalHits(-35, W.floorHeight + 1.65, -46, [0, 0, 1], 6).length);
      close(world.walkHeight(10, -25, W.roofY), W.roofY, 'Roof restored');
    }
    const after = [];
    scene.traverse(object => { if (object.isMesh) after.push(object); });
    assert.equal(after.length, meshes.length);
    assert.deepEqual(new Set(after.map(mesh => mesh.geometry)), geometries);
    follow({ x: 18, y: W.floorHeight, z: -31 },
      { x: SIHANG_EVACUATION.x, y: 0, z: SIHANG_EVACUATION.z });
  });

  it('rebuilds movement colliders after ruin and reset independently of door navigation subscribers', () => {
    const resetWorld = makeSihangBattlefield(new THREE.Scene(),
      (_kind, color) => new THREE.MeshStandardMaterial({ color }));
    resetWorld.doorSystem.onNavigationChanged = () => {};
    const walkThroughPier = () => {
      const feet = new THREE.Vector3(-12, 0, -46);
      resetWorld.moveInfantry(feet, 0, 8, .42);
      return feet;
    };
    const before = walkThroughPier();
    assert.ok(before.z < -42.7, 'Standing north-face pier blocks movement');
    for (let cycle = 0; cycle < 3; cycle++) {
      resetWorld.ruinWarehouse();
      close(walkThroughPier().z, -38, 'Ruined pier no longer blocks movement');
      resetWorld.resetCampaign();
      close(walkThroughPier().z, before.z, 'Restored pier blocks movement again');
      const breach = new THREE.Vector3(-20, 0, -46);
      resetWorld.moveInfantry(breach, 0, 8, .42);
      close(breach.z, -38, 'Reset does not seal genuine wall openings');
    }
  });

  it('bounds static geometry and render submissions and stays within the playable map', () => {
    assert.ok(world.staticRendering.sources > 1000, 'Detailed original shell and city geometry');
    assert.ok(world.staticRendering.batches < 200, 'Static geometry is batched, not one draw per brick');
    assert.ok(world.staticRendering.triangles < 25000);
    let drawCalls = 0;
    scene.traverseVisible(object => { if (object.isMesh) drawCalls++; });
    assert.ok(drawCalls < 250, `Bounded draw count: ${drawCalls}`);
    assert.ok(world.town.buildings.every(building =>
      Math.abs(building.x) + building.width / 2 <= 108 && Math.abs(building.z) + building.depth / 2 <= 108));
    for (const x of [-107.5, 107.5]) {
      const feet = new THREE.Vector3(x, 0, -90);
      world.moveInfantry(feet, Math.sign(x) * 10, 0, .42);
      assert.ok(Math.abs(feet.x) <= 107.58);
    }
  });

  it('provides coherent intact and damaged street blocks, bounded smoke, and reserved combat lanes', () => {
    const buildings = world.town.buildings.slice(1);
    assert.ok(buildings.filter(b => b.damaged).length >= 30);
    assert.ok(buildings.filter(b => !b.damaged).length >= 20);
    assert.ok(buildings.every(b => b.floors === 1 && b.playableFloors.length === 1), 'No invented playable upper floors');
    for (const building of buildings.filter(b => b.damageOpening)) {
      const h = building.damageOpening;
      assert.equal(horizontalHits(h.x, h.y, h.z - 2, [0, 0, 1], 3).length, 0,
        `North city breach ${building.id} is genuinely open`);
    }
    for (const lane of SIHANG_RESERVED_LANES) for (const building of buildings)
      assert.ok(!(building.bounds.minX < lane.maxX && building.bounds.maxX > lane.minX &&
        building.bounds.minZ < lane.maxZ && building.bounds.maxZ > lane.minZ), `${building.id} blocks ${lane.id}`);
    const uses = new Set(buildings.filter(b => !b.damaged).map(b => b.use));
    for (const use of ['hotel', 'restaurant', 'theatre', 'dance-hall', 'inn', 'shop']) assert.ok(uses.has(use));
    assert.equal(world.smoke.length, 30);
    assert.equal(new Set(world.smoke.map(p => p.userData.homeId)).size, 6);
    for (const puff of world.smoke) {
      assert.ok(['originX', 'originY', 'originZ', 'phase'].every(k => Number.isFinite(puff.userData[k])));
      assert.ok(buildings.find(b => b.id === puff.userData.homeId)?.damaged);
    }
    assert.equal(world.sceneArt.city.vegetationDrawCalls, 3);
    assert.ok(world.sceneArt.city.vegetationTriangles < 4000);
    assert.equal(world.sceneArt.city.signDrawCalls, 1);
    assert.ok(world.sceneArt.city.trees >= 14);
    assert.equal(world.town.fortifications.length, 2);
  });
});
