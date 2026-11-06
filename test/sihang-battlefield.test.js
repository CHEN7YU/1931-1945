import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { circleBlocked } from '../src/core.js';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import {
  SIHANG_WAREHOUSE as W, SIHANG_RIVER, SIHANG_BRIDGE, SIHANG_CAPTURE_AREA,
  SIHANG_DEMOLITION_POINT, SIHANG_EVACUATION, SIHANG_DEFENSE_POSTS,
  SIHANG_SQUAD_ORIGINS, SIHANG_ENEMY_APPROACHES, SIHANG_TANK_ORIGINS, SIHANG_STAIR_ROUTES,
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
    assert.equal(W.floorHeight, 4.2); assert.equal(W.floors, 3); assert.equal(W.roofY, 12.6);
    assert.deepEqual(SIHANG_RIVER, { northZ: 8, southZ: 32, waterY: -1 });
    assert.deepEqual(SIHANG_BRIDGE, { x: 48, width: 8, northZ: 8, southZ: 32 });
    assert.equal(SIHANG_CAPTURE_AREA.maxY, 2.4);
    assert.deepEqual(SIHANG_DEMOLITION_POINT, { x: 0, y: 0, z: -43.5 });
    assert.equal(SIHANG_EVACUATION.southZ, 36);
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
      close(world.walkHeight(p.x, p.z, p.y), 4.2, 'Spawn floor support');
      assert.equal(circleBlocked(p.x, p.z, .45, world.obstacles, p.y), false, `Spawn collides: ${JSON.stringify(p)}`);
      const ray = new THREE.Raycaster(point({ ...p, y: 4.3 }), new THREE.Vector3(0, -1, 0), 0, .3);
      const hit = ray.intersectObjects(world.solids, false)[0];
      assert.ok(hit, 'Visible floor supports spawn feet');
      close(hit.point.y, 4.2, 'Physical second-floor mesh');
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

  it('walks actual feet up and down every flight in both connected stairwells', () => {
    for (const route of SIHANG_STAIR_ROUTES) {
      const up = follow(route.bottom, route.top);
      assert.ok(up.heights.size > 20, 'Gradual supported ascent');
      follow(route.top, route.bottom);
    }
    const result = follow({ x: 0, y: 0, z: -60 }, { x: 0, y: 12.6, z: -12 });
    for (const y of [0, 4.2, 8.4, 12.6]) assert.ok(result.heights.has(y));
    follow({ x: 0, y: 12.6, z: -12 }, { x: -78, y: 0, z: -88 });
  });

  it('replans from mid-flight without teleporting and routes to supported stair goals', () => {
    follow({ x: 24, y: 6.3, z: -26 }, { x: -18, y: 8.4, z: -31 });
    follow({ x: -32, y: 10.5, z: -26 }, { x: 0, y: 0, z: -60 });
    follow({ x: 18, y: 4.2, z: -31 }, { x: 24, y: 6.3, z: -26 });
    follow({ x: 24, y: .84, z: -32 }, { x: 24, y: 3.36, z: -20 });
  });

  it('physically recenters exact live retreat edge cases before descending and rejoins landing collars', () => {
    const goal = { x: 48, y: 0, z: 48 };
    const starts = [
      { x: 21.508886, y: 4.021943, z: -16.847888 },
      { x: 26.150014, y: 4.168407, z: -16.150445 },
      { x: 25.208039, y: 4.2, z: -15.623339 },
      { x: 21.232936, y: 0, z: -33.74558 },
    ];
    for (const [index, start] of starts.entries()) {
      const path = world.elevatedPath(start, goal);
      assert.ok(path.length, `Live edge case ${index} has a physical escape route`);
      if (index < 2) {
        const safe = path.findIndex(p => p.x >= 22.1 - .001 && p.x <= 25.9 + .001);
        assert.ok(safe >= 0, 'First rejoin reaches a capsule-safe ramp lane');
        for (let i = 0; i <= safe; i++) {
          close(path[i].z, start.z, 'Recenter first, without descending', .001);
          close(path[i].y, start.y, 'Recenter retains physical support', .001);
        }
      } else {
        close(path[0].y, start.y, 'Projected-navigation rejoin preserves the starting floor');
        assert.ok(Math.hypot(path[0].x - start.x, path[0].z - start.z) <= .12);
      }
      follow(start, goal, path);
    }
  });

  it('keeps ramp-edge rejoining physical on both stairwells and every storey', () => {
    const goal = { x: 48, y: 0, z: 48 };
    for (const x of [-32, 24]) for (let floor = 0; floor < 3; floor++) {
      for (const offset of [-2.491114, 2.150014]) {
        const z = -16.847888, y = floor * 4.2 + (z + 36) * .21;
        follow({ x: x + offset, y, z }, goal);
      }
      follow({ x: x + 1.208039, y: (floor + 1) * 4.2, z: -15.623339 }, goal);
    }
    assert.deepEqual(world.elevatedPath({ x: -12, y: 0, z: -42 }, goal), [],
      'A real masonry obstruction cannot be bypassed by a projected-start fallback');
  });

  it('has real floor cutouts, not transparent floors spanning the stairs', () => {
    scene.updateMatrixWorld(true);
    for (const x of [-32, 24]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 13, -26), new THREE.Vector3(0, -1, 0), 0, 3);
      const hits = ray.intersectObjects(world.solids, false);
      assert.ok(hits.length, 'Top flight exists below the roof cutout');
      assert.ok(hits[0].point.y < 11 && hits[0].point.y > 10, 'Roof slab does not cap the stairwell');
      const feet = new THREE.Vector3(x === 24 ? 20.5 : -28.5, 8.4, -26);
      world.moveInfantry(feet, x === 24 ? 3.5 : -3.5, 0, .42);
      assert.ok(Math.abs(feet.x - x) > 2, 'Cannot side-step into an unsupported stair void');
    }
  });

  it('has real shot openings on every storey and second-floor defense firing apertures', () => {
    for (const y of [1.65, 5.85, 10.05]) {
      assert.equal(horizontalHits(0, y, -46, [0, 0, 1], 6).length, 0, 'North central breach is open');
      assert.equal(horizontalHits(0, y, -4, [0, 0, -1], 6).length, 0, 'South central breach is open');
      assert.ok(horizontalHits(-12, y, -46, [0, 0, 1], 6).length, 'Visible masonry pier still stops shots');
    }
    assert.equal(SIHANG_DEFENSE_POSTS.length, 4);
    for (const p of SIHANG_DEFENSE_POSTS) {
      assert.equal(circleBlocked(p.x, p.z, .42, world.obstacles, p.y), false);
      close(world.walkHeight(p.x, p.z, p.y), 4.2, 'Defense floor');
      assert.equal(horizontalHits(p.x, p.y + 1.5, p.z,
        [0, 0, p.z < -25 ? -1 : 1], 5).length, 0, 'Defense post fires through an actual opening');
    }
    const feet = new THREE.Vector3(0, 0, -46);
    world.moveInfantry(feet, 0, 8, .42);
    close(feet.z, -38, 'Ground breach is also a walkable entrance');
    const pier = new THREE.Vector3(-12, 0, -46);
    world.moveInfantry(pier, 0, 8, .42);
    assert.ok(pier.z < -42.7, 'Movement respects surviving wall piers');
  });

  it('routes second-floor squads onto a smooth arched bridge and the south-bank evacuation area', () => {
    for (const origin of SIHANG_SQUAD_ORIGINS)
      follow(origin, { x: SIHANG_EVACUATION.x, y: 0, z: SIHANG_EVACUATION.z });
    const feet = new THREE.Vector3(48, 0, 6);
    let highest = 0;
    scene.updateMatrixWorld(true);
    for (let i = 0; i < 280; i++) {
      world.moveInfantry(feet, 0, .1, .42);
      highest = Math.max(highest, feet.y);
      if (feet.z > 8 && feet.z < 32) {
        const ray = new THREE.Raycaster(new THREE.Vector3(feet.x, feet.y + .05, feet.z), new THREE.Vector3(0, -1, 0), 0, .12);
        const hit = ray.intersectObjects(world.solids, false)[0];
        assert.ok(hit, 'Arched bridge visually supports the feet');
        close(hit.point.y, feet.y, 'Bridge deck vs walking height', .005);
      }
    }
    close(highest, 1.15, 'Bridge has an actual arch');
    close(feet.y, 0, 'Returns smoothly to south street');
    close(feet.z, 34, 'Crosses to the south');
    follow({ x: 48, y: 0, z: 40 }, { x: 48, y: 0, z: 0 });
  });

  it('rejects river shortcuts across the full width and routes ground traffic over the only bridge', () => {
    for (const x of [-107, -80, 0, 40, 56, 90, 107]) {
      assert.equal(world.isDeepWater(x, 20), true);
      const feet = new THREE.Vector3(x, 0, 5);
      world.moveInfantry(feet, 0, 35, .42);
      assert.ok(feet.z < 8, 'Cannot wade or tunnel through the north bank');
      const south = new THREE.Vector3(x, 0, 35);
      world.moveInfantry(south, 0, -35, .42);
      assert.ok(south.z > 32, 'Cannot wade from the south either');
    }
    assert.equal(world.isDeepWater(48, 20), false);
    assert.equal(world.impactHeight(0, 20), -1);
    const path = follow({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 42 });
    assert.ok(path.route.some(p => p.x >= 44 && p.x <= 52), 'Navigation uses the east bridge');
    const edge = new THREE.Vector3(48, 1.15, 20);
    world.moveInfantry(edge, -15, 0, .42);
    assert.ok(edge.x >= 44.4, 'Real bridge railing blocks a sideways river exit');
  });

  it('keeps 36 varied, animated skinned civilians on actual south-bank routes', () => {
    assert.equal(world.civilians.length, 36);
    const ages = new Set(), presentations = new Set();
    const enteredShops = new Set();
    const starts = world.civilians.map(p => p.position.clone());
    for (const person of world.civilians) {
      ages.add(person.userData.ageGroup); presentations.add(person.userData.presentation);
      assert.ok(person.civilianSkin.mesh.isSkinnedMesh);
      assert.ok(person.userData.route.every(p => p.z > 32));
    }
    assert.equal(ages.size, 3); assert.equal(presentations.size, 2);
    for (let tick = 0; tick < 300; tick++) {
      world.doorSystem.update(.25, world.civilians.map(person => ({ ...person.position, radius: .27 })));
      world.updateCivilians(.25, tick * .25);
      for (const person of world.civilians) {
        assert.ok(person.position.z > 32, 'Civilian never crosses the river');
        assert.equal(circleBlocked(person.position.x, person.position.z, .26, world.obstacles), false);
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
      assert.equal(world.walkHeight(0, -25, 12.6), 0);
      assert.equal(horizontalHits(-12, 5.85, -46, [0, 0, 1], 6).length, 0, 'No invisible standing shell');
      assert.deepEqual(world.elevatedPath({ x: 0, y: 12.6, z: -12 }, { x: 0, y: 0, z: -60 }), []);
      world.civilians[0].userData.dead = true; world.civilians[0].visible = false;
      world.civilians[0].position.set(0, -1, 20);
      world.flags[0].material.color.setHex(0xff0000);
      world.resetCampaign();
      assert.equal(world.warehouseRuined, false);
      assert.equal(warehouse.intact.visible, true); assert.equal(warehouse.rubble.visible, false);
      assert.equal(world.solids.length, normalSolids); assert.equal(world.obstacles.length, normalObstacles);
      assert.equal(new Set(world.obstacles).size, normalObstacles);
      assert.equal(world.civilians[0].userData.dead, false); assert.equal(world.civilians[0].visible, true);
      assert.ok(world.civilians[0].position.z > 32);
      assert.equal(world.flags[0].material.color.getHex(), 0x557ca5);
      assert.ok(horizontalHits(-12, 5.85, -46, [0, 0, 1], 6).length);
      close(world.walkHeight(0, -25, 12.6), 12.6, 'Roof restored');
    }
    const after = [];
    scene.traverse(object => { if (object.isMesh) after.push(object); });
    assert.equal(after.length, meshes.length);
    assert.deepEqual(new Set(after.map(mesh => mesh.geometry)), geometries);
    follow({ x: 18, y: 4.2, z: -31 }, { x: 48, y: 0, z: 48 });
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
      const breach = new THREE.Vector3(0, 0, -46);
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
});
