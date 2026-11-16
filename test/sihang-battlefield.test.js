import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { circleBlocked } from '../src/core.js';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { SIHANG_EMPLACEMENTS, sihangRetreatGoal, sihangRetreatVehicleBypass } from '../src/sihang-roster.js';
import { addSihangBridgeDefenses } from '../src/sihang-bridge-defenses.js';
import { createSquadRoutes } from '../src/squad-routes.js';
import { sampledRouteClear } from '../src/infantry-spacing.js';
import { vehicleCollider } from '../src/entities.js';
import { sihangParadeExit, sihangParadePassage } from '../src/sihang-formation.js';
import {
  SIHANG_WAREHOUSE as W, SIHANG_RIVER, SIHANG_BRIDGE, SIHANG_CAPTURE_AREA,
  SIHANG_DEMOLITION_POINT, SIHANG_EVACUATION, SIHANG_DEFENSE_POSTS,
  SIHANG_SQUAD_ORIGINS, SIHANG_ENEMY_APPROACHES, SIHANG_TANK_ORIGINS, SIHANG_STAIR_ROUTES,
  sihangRiverBounds, sihangSouthBank, SIHANG_RESERVED_LANES, SIHANG_LEVELS,
  SIHANG_STAIRWELLS, sihangStairHeight, SIHANG_NORTH_APERTURES,
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
      const door = world.doorSystem.openAhead(feet, waypoint);
      if (door) {
        for (let frame = 0; frame < 60; frame++)
          world.doorSystem.update(1 / 60, [{ x: feet.x, y: feet.y, z: feet.z, radius: .42 }]);
        assert.equal(door.state, 'open', 'the route waits until the real leaf clears its sweep');
        const updated = follow({ x: feet.x, y: feet.y, z: feet.z }, goal);
        updated.heights = new Set([...heights, ...updated.heights]);
        return updated;
      }
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
  it('does not place decorative civilian remains on the river', () => {
    assert.equal(scene.children.filter(child => child.name === 'floating-civilian-remains').length, 0);
    world.updateWater(1);
    assert.equal(scene.children.filter(child => child.name === 'floating-civilian-remains').length, 0);
  });

  it('evacuees pass the actual parade tail and battle boundary instead of crowding one terminal coordinate', () => {
    const tail = sihangParadeExit(true), exit = sihangParadeExit();
    assert.equal(sihangParadePassage({ x: tail.x, y: 0, z: tail.z - .2 }, tail), true,
      'ordinary navigation arrival must already be beyond the physical passage, not stop short of it');
    assert.equal(sihangParadePassage({ x: 65.3685676, y: 0, z: 64.6593933 }, tail), true);
    assert.equal(sihangParadePassage({ x: 64, y: 0, z: 64.4 }, tail), false);
    assert.equal(sihangParadePassage({ x: 70, y: 0, z: 65 }, tail), false);
    assert.equal(sihangParadePassage({ x: 66.6055121, y: 0, z: 73.5798519 }, exit), true);
    assert.equal(sihangParadePassage({ x: 64, y: 0, z: 71.99 }, exit), false);
    assert.equal(sihangParadePassage({ x: 64, y: 2, z: 73.2 }, exit), false);
  });

  it('preserves the arched walking height when actual bridge routes are shared between soldiers', () => {
    const routes = createSquadRoutes(world.walkHeight);
    const goal = { ...sihangBridgePoint(1 + 4 / SIHANG_BRIDGE.length, 1.15), y: 0 };
    const person = fraction => ({ position: { ...sihangBridgePoint(fraction, 1.15), y: 0 },
      formation: { id: 'real-bridge', type: 'infantry' }, tactics: {} });
    const lead = person(-.25), follower = person(-.2);
    routes.find(lead, goal, 0, () => world.elevatedPath(lead.position, goal), world.connectInfantryPath);
    const shared = routes.find(follower, goal, .1,
      () => { throw new Error('Expected to exercise the cached actual bridge route'); }, world.connectInfantryPath);
    assert.equal(routes.snapshot.shared, 1);
    assert.ok(shared.some(point => point.y > 1));
    for (const point of shared) close(point.y, world.walkHeight(point.x, point.z, point.y), 'Cached bridge support');
    follow(follower.position, goal, shared);
  });
  before(() => {
    scene = new THREE.Scene();
    world = makeSihangBattlefield(scene, (kind, color) => {
      assert.ok(['brick', 'plaster', 'tiles', 'paving', 'earth', 'timber'].includes(kind), 'Supported shared surface');
      return new THREE.MeshStandardMaterial({ color });
    });
    const planar = { streets: world.town.streets,
      houses: world.town.buildings.map(b => ({ id: b.id, x: b.x, z: b.z, width: b.width,
        depth: b.depth, bounds: b.bounds, exit: b.exit })),
      passages: world.town.passages.map(p => ({ id: p.id, groupId: p.groupId, x: p.x, z: p.z,
        width: p.width, axis: p.axis, hingeDirection: p.hingeDirection, openAngle: p.openAngle })) };
    const addedHouses = new Set(['concession-riverside-1', 'concession-riverside-2']);
    const originalPlanar = { ...planar,
      houses: planar.houses.filter(house => !addedHouses.has(house.id)),
      passages: planar.passages.filter(passage => !addedHouses.has(passage.groupId?.replace(/-front-door$/, ''))) };
    assert.equal(createHash('sha256').update(JSON.stringify(originalPlanar)).digest('hex'),
      'f45daba9de233bf47316bf4afe4c9f9ed03b82701e6d1c5d15eb183a59f2bf34',
      'Existing streets, buildings and doorways retain their original contract');
    assert.equal(createHash('sha256').update(JSON.stringify(planar)).digest('hex'),
      '9a44fd293ec12c760be545deb14cfd7ee68e8f500481dca097e432e08d8e7cda',
      'The two added narrow houses and their doorways remain deterministic');
    const layout = { obstacles: world.obstacles, passages: world.town.passages, streets: world.town.streets,
      houses: world.town.buildings.map(b => ({ id: b.id, x: b.x, z: b.z, width: b.width, depth: b.depth,
        height: b.height, bounds: b.bounds, exit: b.exit, damageOpening: b.damageOpening })) };
    assert.equal(createHash('sha256').update(JSON.stringify(layout.houses.filter(house => !addedHouses.has(house.id)))).digest('hex'),
      'fa3a6c76b3f30b3931e309826763f68240a36a8025d57adac564c1d7b2a0da3c',
      'Existing house heights and openings retain their original contract');
    assert.equal(createHash('sha256').update(JSON.stringify(layout)).digest('hex'),
      'e325687ef2b06078d64cd79209f9f15a3c2dfa4c58b60bf6557ec46009a10209',
      'Warehouse geometry, bridge water collision, gun cover and south-bank buildings remain deterministic');
  });
  beforeEach(() => world.resetCampaign());

  it('keeps the added narrow riverside houses on dry, separated, accessible lots', () => {
    for (const [id, x] of [['concession-riverside-1', -78], ['concession-riverside-2', -54]]) {
      const house = world.town.buildings.find(building => building.id === id);
      assert.ok(house, `${id} must be present`);
      assert.equal(house.x, x);
      assert.equal(house.width, 5);
      assert.equal(house.depth, 6);
      const bank = Math.max(sihangRiverBounds(house.bounds.minX).southZ,
        sihangRiverBounds(house.bounds.maxX).southZ);
      assert.ok(house.bounds.minZ >= bank + 3, `${id} lot must clear the river`);
      for (const other of world.town.buildings.filter(building => building !== house && building.bounds))
        assert.ok(!(house.bounds.minX < other.bounds.maxX && house.bounds.maxX > other.bounds.minX &&
          house.bounds.minZ < other.bounds.maxZ && house.bounds.maxZ > other.bounds.minZ),
        `${id} overlaps ${other.id}`);
      assert.equal(world.town.passages.filter(passage => passage.groupId === `${id}-front-door`).length, 2);
      follow({ x, y: 0, z: house.z - house.depth / 2 - 2 }, { x, y: 0, z: house.z });
    }
  });

  it('detonation opens a real jagged north-wall breach, preserves the warehouse, and resets its collision and navigation', () => {
    const solids = world.solids.length, obstacles = world.obstacles.length;
    for (let cycle = 0; cycle < 2; cycle++) {
      assert.equal(world.northWallBreached, false);
      assert.ok(horizontalHits(0, 1.2, -46, [0, 0, 1], 9).length);
      world.elevatedPath({ x: 0, y: 0, z: -60 }, { x: 0, y: 0, z: -60 });
      world.elevatedPath({ x: 0, y: W.floorHeight, z: -38 }, { x: 0, y: W.floorHeight, z: -38 });
      const builds = world.navigationStats.builds;
      assert.equal(world.breachNorthWall(), true); assert.equal(world.breachNorthWall(), false);
      assert.equal(world.warehouseRuined, false);
      assert.equal(world.landmarks.warehouse.intact.visible, true);
      assert.equal(scene.getObjectByName('sihang-north-wall-intact').visible, false);
      assert.equal(scene.getObjectByName('sihang-north-wall-breached').visible, true);
      for (const x of [-1.8, -.9, 0, .9, 1.8]) {
        assert.equal(horizontalHits(x, 1.75, -46, [0, 0, 1], 9).length, 0);
        const feet = new THREE.Vector3(x, 0, -46);
        for (let step = 0; step < 80; step++) world.moveInfantry(feet, 0, .1, .42);
        assert.ok(feet.z > -39 && feet.y === 0, 'five lanes pass real full-height movement collision');
        const route = world.elevatedPath({ x, y: 0, z: -50 }, { x, y: 0, z: -37 });
        assert.ok(route.length);
        assert.ok(route.some(point => point.z > -42), 'navigation reaches inside the new breach');
      }
      assert.ok(horizontalHits(8, 1.75, -46, [0, 0, 1], 9).length, 'adjacent masonry stays solid');
      world.elevatedPath({ x: 0, y: W.floorHeight, z: -38 }, { x: 0, y: W.floorHeight, z: -38 });
      assert.equal(world.navigationStats.builds, builds, 'detonation refreshes local cells instead of rebuilding floor grids');
      assert.equal(world.walkHeight(0, -40, W.floorHeight), W.floorHeight);
      assert.equal(new Set(world.solids).size, world.solids.length);
      world.resetCampaign();
      assert.equal(world.solids.length, solids); assert.equal(world.obstacles.length, obstacles);
      assert.ok(horizontalHits(0, 1.2, -46, [0, 0, 1], 9).length);
      assert.equal(circleBlocked(0, -42, .42, world.doorSystem.navigationObstacles), true);
    }
  });

  it('exports the coordinate contract and a complete standalone world', () => {
    assert.equal(W.width, 64); assert.equal(W.depth, 34);
    assert.equal(W.floorHeight, 7.2); assert.equal(W.floors, 3); assert.equal(W.roofY, 21.6);
    assert.deepEqual(SIHANG_LEVELS, [0, 7.2, 14.4, 21.6]);
    assert.deepEqual(SIHANG_RIVER, { northZ: 0, southZ: 32, waterY: -1 });
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
    assert.equal(world.staticDamage.craters.length, 6);
    assert.deepEqual(world.staticDamage.ruinedShops, []);
    assert.deepEqual(world.staticDamage.wrecks, []);
    scene.updateMatrixWorld(true);
    for (const crater of world.staticDamage.craters) {
      const ray = new THREE.Raycaster(new THREE.Vector3(crater.x, 3, crater.z), new THREE.Vector3(0, -1, 0));
      close(ray.intersectObjects(world.solids)[0].point.y, -crater.depth, 'real bowl, no flat road cap', .002);
      close(world.groundHeight(crater.x, crater.z), -crater.depth, 'physical shell-hole support', .002);
    }
    assert.equal(world.buildingFire.sources.length, 0, 'Sihang has no persistent building fires');
    world.buildingFire.update(12);
    assert.deepEqual(world.buildingFire.snapshot, { sources: 0, smoke: 0, flames: 0, drawCalls: 0 });
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

  it('fits all 44 allies on supported ground-floor positions without walls or stair holes', () => {
    const spawns = SIHANG_SQUAD_ORIGINS.flatMap(origin =>
      Array.from({ length: 11 }, (_, i) => ({
        x: origin.x + (i % 4 - 1.5) * 1.6,
        z: origin.z + (Math.floor(i / 4) - 1) * 1.6, y: origin.y,
      })));
    assert.equal(spawns.length, 44);
    scene.updateMatrixWorld(true);
    for (const p of spawns) {
      close(p.y, 0, 'Initial ground-floor deployment');
      close(world.walkHeight(p.x, p.z, p.y), p.y, 'Spawn floor support');
      assert.equal(circleBlocked(p.x, p.z, .45, world.obstacles, p.y), false, `Spawn collides: ${JSON.stringify(p)}`);
      const ray = new THREE.Raycaster(point({ ...p, y: p.y + .1 }), new THREE.Vector3(0, -1, 0), 0, .3);
      const hit = ray.intersectObjects(world.solids, false)[0];
      assert.ok(hit, 'Visible floor supports spawn feet');
      close(hit.point.y, p.y, 'Physical ground-floor mesh');
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
    assert.equal(holes.filter(h => h.blown).length, 14, 'Reference north apertures and selected other panels have shell breaches');
    const gate = world.doorSystem.doors.find(door => door.groupId === 'sihang-warehouse-north-gate');
    assert.equal(gate.state, 'closed');
    world.doorSystem.interact(gate, { x: -20, z: -45 });
    for (let frame = 0; frame < 60; frame++) world.doorSystem.update(1 / 60, []);
    for (const hole of holes) {
      const west = hole.x === W.minX, east = hole.x === W.maxX;
      const direction = hole.axis === 'z' ? [west ? 1 : -1, 0, 0] : [0, 0, hole.z === W.minZ ? 1 : -1];
      const startX = hole.axis === 'z' ? hole.x + (west ? -2 : 2) : hole.x;
      const startZ = hole.axis === 'x' ? hole.z + (hole.z === W.minZ ? -2 : 2) : hole.z;
      assert.equal(horizontalHits(startX, hole.y, startZ, direction, 2.5).length, 0, `Real facade aperture ${hole.id}`);
      assert.equal(east || west || hole.axis === 'x', true);
    }
    for (const x of [W.minX, W.maxX]) for (const z of [-41, -9])
      assert.ok(horizontalHits(x + (x === W.minX ? -2 : 2), 6, z,
        [x === W.minX ? 1 : -1, 0, 0], 3).length, 'Intact corners support the shell');
    assert.equal(SIHANG_DEFENSE_POSTS.length, 22);
    for (const p of SIHANG_DEFENSE_POSTS) {
      assert.equal(circleBlocked(p.x, p.z, .42, world.obstacles, p.y), false);
      close(world.walkHeight(p.x, p.z, p.y), p.y, 'Defense floor');
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

  it('provides 22 distinct firing positions through real breaches and east windows across both upper floors', () => {
    assert.equal(new Set(SIHANG_DEFENSE_POSTS.map(p => `${p.x},${p.z}`)).size, 22);
    assert.equal(SIHANG_DEFENSE_POSTS.filter(p => p.facade === 'north').length, 8);
    assert.equal(SIHANG_DEFENSE_POSTS.filter(p => p.facade === 'east').length, 14);
    for (const p of SIHANG_DEFENSE_POSTS) {
      const aperture = world.landmarks.warehouse.breaches.find(h => h.id === p.apertureId);
      assert.ok(aperture, `Registered aperture for ${p.id}`);
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

  it('matches the reference aperture groups with real bidirectional bullet paths and places the charge below the largest hole', () => {
    const areas = SIHANG_NORTH_APERTURES.map(hole => Math.abs(hole.outline.reduce((area, a, index) => {
      const b = hole.outline[(index + 1) % hole.outline.length];
      return area + a[0] * b[1] - b[0] * a[1];
    }, 0)) / 2);
    assert.equal(Math.max(...areas), areas[0], 'The shared demolition coordinate references the largest actual cutout');
    assert.equal(SIHANG_DEMOLITION_POINT.x, SIHANG_NORTH_APERTURES[0].u);
    assert.ok(SIHANG_DEMOLITION_POINT.z < W.minZ);
    for (const hole of SIHANG_NORTH_APERTURES) {
      for (const direction of [-1, 1]) {
        assert.equal(horizontalHits(hole.u, (hole.bottom + hole.top) / 2, W.minZ - direction * .7,
          [0, 0, direction], 1.4).length, 0, `${hole.id} is open in both firing directions`);
      }
    }
    const referenceY = y => y * W.floorHeight / 8.4;
    for (const x of [-30, -22, -6, 10, 18, 25])
      assert.ok(horizontalHits(x, referenceY(9.8), -43, [0, 0, 1], 2).length, 'Former repeated window row is solid reference masonry');
    assert.ok(horizontalHits(0, referenceY(21.48), -43, [0, 0, 1], 2).length, 'Concrete bridge between the two principal holes remains solid');
    assert.ok(horizontalHits(2.2, referenceY(17.4), -43, [0, 0, 1], 2).length, 'Jagged solid corners are not replaced with a rectangular cutout');
    assert.equal(horizontalHits(1.7, referenceY(18.1), -43, [0, 0, 1], 2).length, 0, 'The adjacent real polygon opening remains clear');
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

  it('evacuates every individual firing-post lane through the real stairs and bridge', () => {
    for (let index = 0; index < SIHANG_DEFENSE_POSTS.length; index++) {
      const start = SIHANG_DEFENSE_POSTS[index], actor = { index: index % 11, position: { ...start } };
      for (let leg = 0; leg < 3; leg++) {
        const goal = sihangRetreatGoal(actor);
        assert.equal(world.groundHeight(goal.x, goal.z), 0, 'assembly targets cannot sit on the sloped bridge with y=0');
        actor.position = follow(actor.position, goal).feet;
        if (sihangSouthBank(actor.position, 4)) break;
      }
      assert.equal(sihangSouthBank(actor.position, 4), true, `Original firing-post defender ${index} must escape`);
    }
  });

  it('keeps the riverside withdrawal columns on dry, unobstructed ground and rejoins the bridge', () => {
    const scene = new THREE.Scene();
    const world = makeSihangBattlefield(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }));
    addSihangBridgeDefenses(scene, world, SIHANG_EMPLACEMENTS.filter(spec => spec.retreatCover));
    for (const index of [0, 1]) {
      const actor = { index, playerUnit: false, formation: { sihangSlot: 1 }, tactics: {},
        position: { x: -30, y: 0, z: sihangRiverBounds(-30).northZ - (index ? 3.2 : 2) } };
      for (let leg = 0; leg < 18; leg++) {
        const from = actor.position, goal = sihangRetreatGoal(actor);
        assert.ok(goal.x > from.x, JSON.stringify({ from, goal }));
        assert.ok(sampledRouteClear(from, goal, (x, z) => !world.isDeepWater(x, z) &&
          !circleBlocked(x, z, .46, world.obstacles, 0)), JSON.stringify({ from, goal }));
        actor.position = { ...goal };
      }
      const approach = sihangRetreatGoal(actor);
      assert.deepEqual(approach, { ...sihangBridgePoint(-.2, (index % 5 - 2) * 1.15), y: 0, transit: true });
      const path = world.elevatedPath(actor.position, approach);
      assert.ok(path.length && Math.hypot(path.at(-1).x - approach.x, path.at(-1).z - approach.z) <= .8);
    }
    const actor = { index: 0, playerUnit: false, formation: { sihangSlot: 0 }, tactics: {},
      position: { x: 28, y: 0, z: -5 } };
    assert.deepEqual(sihangRetreatGoal(actor), { ...sihangBridgePoint(-.2, -2.3), y: 0, transit: true });
    assert.equal(actor.tactics.sihangRiversideWaypoint, undefined);
    const diverted = { index: 0, playerUnit: false, formation: { sihangSlot: 1 },
      tactics: { sihangRiversideWaypoint: 1 }, position: { x: 45, y: 0, z: -5 } };
    assert.equal(sihangRetreatGoal(diverted).x, 46, 'a detour must not send a soldier back to an old waypoint');
  });

  it('finds a clear bridge approach around a tank blocking the normal retreat goal', () => {
    const start = { x: 76.5, y: 0, z: -33.6 };
    const tank = vehicleCollider({ variant: 'chi-ha',
      position: { x: 74.76838959948437, z: -31.500621994607055 }, heading: 4.7097034657860535 });
    const obstacles = [...world.obstacles, tank];
    const clearPoint = p => !world.isDeepWater(p.x, p.z) &&
      Math.abs(world.walkHeight(p.x, p.z, 0)) <= .3 &&
      !circleBlocked(p.x, p.z, .46, obstacles.filter(obstacle =>
        !obstacle.walkable || obstacle.height > world.walkHeight(p.x, p.z, 0) + .25), 0);
    const clearSegment = (a, b) => sampledRouteClear(a, b, (x, z) => clearPoint({ x, z }));
    const path = sihangRetreatVehicleBypass(start, tank, clearPoint, clearSegment);
    assert.ok(path.length > 1, 'the route must go around the vehicle, not through it');
    let previous = start;
    for (const waypoint of path) {
      assert.ok(clearPoint(waypoint) && clearSegment(previous, waypoint));
      previous = waypoint;
    }
    assert.ok(sihangBridgeCoordinates(previous).along > -4.5, 'the route reaches the bridge entrance');
    assert.deepEqual(sihangRetreatVehicleBypass(start, tank, () => false, () => false), []);
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
    const path = follow({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 42 });
    assert.ok(path.route.some(p => sihangBridgeContains(p)), 'Navigation uses the actual diagonal bridge');
    const edge = new THREE.Vector3(center.x, 1.15, center.z);
    const sideways = sihangBridgePoint(.5, -15);
    world.moveInfantry(edge, sideways.x - center.x, sideways.z - center.z, .42);
    assert.ok(Math.abs(sihangBridgeCoordinates(edge).across) <= SIHANG_BRIDGE.width / 2 - .35,
      'Real diagonal bridge railing blocks a sideways river exit');
  });

  it('keeps the actual bridge deck clear of river collision near both railings', () => {
    for (let fraction = .1; fraction <= .9; fraction += .05) for (const lateral of [-3, 3]) {
      const point = sihangBridgePoint(fraction, lateral);
      const y = world.walkHeight(point.x, point.z, 0);
      assert.equal(circleBlocked(point.x, point.z, .42, world.obstacles.filter(o => o.water), y),
        false, `water collider overlaps bridge deck at ${fraction}, ${lateral}`);
    }
    for (let fraction = .1; fraction <= .9; fraction += .05) for (const lateral of [-6, -5, 5, 6]) {
      const point = sihangBridgePoint(fraction, lateral);
      if (world.isDeepWater(point.x, point.z))
        assert.equal(circleBlocked(point.x, point.z, .05, world.obstacles.filter(o => o.water)), true,
          `river must remain blocked outside the bridge at ${fraction}, ${lateral}`);
    }
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
      assert.ok(breach.z < -42.4, 'Reset closes the new actual gate while keeping its architectural opening');
      const gate = resetWorld.doorSystem.doors.find(door => door.groupId === 'sihang-warehouse-north-gate');
      resetWorld.doorSystem.interact(gate, { x: -20, z: -46 });
      for (let frame = 0; frame < 60; frame++) resetWorld.doorSystem.update(1 / 60, []);
      const opened = new THREE.Vector3(-20, 0, -46);
      resetWorld.moveInfantry(opened, 0, 8, .42);
      close(opened.z, -38, 'Opening the gate restores the original doorway passage');
    }
  });

  it('bounds static geometry and render submissions and stays within the playable map', () => {
    assert.ok(world.staticRendering.sources > 1000, 'Detailed original shell and city geometry');
    assert.ok(world.staticRendering.batches < 200, 'Static geometry is batched, not one draw per brick');
    assert.ok(world.staticRendering.triangles < 40000,
      'Bounded neighborhood with shared Nanjing curved tile roofs, shell holes and sandbags');
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
    assert.ok(buildings.filter(b => !b.damaged).length >= 7, 'the active riverside shops remain after removing two rear rows');
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
    assert.equal(world.sceneArt.city.trees, 7, 'rear-row trees are removed with the cropped blocks');
    assert.equal(world.town.fortifications.filter(point => point.id.startsWith('warehouse-ground-sandbags')).length, 6);
    for (const x of [-28, -12]) {
      assert.equal(world.town.fortifications.some(point => point.id === `north-gate-sandbags-${x}`), false);
      assert.equal(world.obstacles.some(obstacle => obstacle.minX === x - 3 * .75 - .4 &&
        obstacle.maxX === x - 3 * .75 + .4 && obstacle.minZ === -49.4 - .55 / 2 &&
        obstacle.maxZ === -49.4 + .55 / 2), false, 'removed machine-gun barricades leave no original collider');
    }
  });
});
