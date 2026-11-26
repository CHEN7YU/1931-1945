import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { NANJING_CITY_WALLS, NANJING_DOCK, NANJING_DOCK_ENTRY_X, NANJING_DOCK_SHIFT, NANJING_DOCK_ASSAULT_SPAWNS, NANJING_FERRY_BERTHS, NANJING_RIVER_SHORE_X, NANJING_SPAWNS, NANJING_WEST_BREACH, NANJING_WEST_GATE_HALF_WIDTH, NANJING_WEST_GATE_Z,
  nanjingDefensePost, nanjingWallExitWaypoint } from '../src/nanjing-campaign.js';
import { ferryBoardingPoints } from '../src/nanjing-ferry.js';
import { NANJING_COURTYARDS, NANJING_COURTYARD_HALF_WIDTH, NANJING_COURTYARD_WIDTH,
  NANJING_FLANKING_BUFFERS, NANJING_FLANKING_BUFFER_WIDTH, NANJING_GATE_HEIGHT, NANJING_GATE_LENGTH,
  NANJING_GATE_NORTH_EDGE, NANJING_GATE_SOUTH_EDGE,
  NANJING_GATE_TUNNEL, NANJING_GATE_WIDTH, NANJING_MAP_SCALE, NANJING_RAMPART_HEIGHT,
  NANJING_RAMPART_THICKNESS, NANJING_SOLDIER_CAVE, NANJING_SOLDIER_CAVES, NANJING_WALL_RAMPS,
  NANJING_WALL_WALK, NANJING_WALL_WALKS } from '../src/nanjing-layout.js';
import { formationPositions, FormationPlacementError, nanjingBattleRoster } from '../src/battle-roster.js';
import { spawnBlockReason } from '../src/spawns.js';
import { circleBlocked, createNavigator, segmentClear } from '../src/core.js';
import { createSolidIndex } from '../src/solid-index.js';
import { createOcclusionQuery } from '../src/occlusion-query.js';
import { assignNanjingDefense, nanjingDefenseGoal, nanjingWallEntryWaypoint } from '../src/nanjing-defense.js';
import { casemateGateSlices } from '../src/nanjing-casemate.js';
import { BATTLE_AREA } from '../src/battle-boundary.js';
import { NANJING_EMPLACEMENTS } from '../src/emplacements.js';
import { NANJING_WALL_PLUMES } from '../src/nanjing-wall-damage.js';
import { moveSupported } from '../src/infantry-traversal.js';

function housePoint(home, x, z) {
  const c = [1, 0, -1, 0][home.facing], s = [0, 1, 0, -1][home.facing];
  return { x: home.x + x * c + z * s, z: home.z - x * s + z * c };
}

test('west gate stairs turn at an intermediate landing and connect to the gate crown in both directions', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const position = new THREE.Vector3(-63.75, 0, -78.85);
  const move = (dx, dz) => moveSupported(position, dx, dz, .4, world.obstacles,
    world.walkHeight, world.moveInfantry, 1.75, 2);
  move(-5, 0);
  assert.ok(Math.abs(position.x + 68.75) < .05 && Math.abs(position.y - NANJING_WALL_WALK.height / 2) < .05,
    `lower flight must reach the turn: ${JSON.stringify(position)}`);
  move(0, 5.1);
  assert.ok(Math.abs(position.z + 73.75) < .05 && Math.abs(position.y - NANJING_WALL_WALK.height) < .05,
    `upper flight must reach the wall landing: ${JSON.stringify(position)}`);
  move(-1.5, 0);
  move(0, 13.75);
  assert.ok(Math.abs(position.z - NANJING_WEST_GATE_Z) < .1 &&
    Math.abs(position.y - NANJING_WALL_WALK.height) < .05,
  `wall walk must reach the gate crown: ${JSON.stringify(position)}`);
  move(0, -13.75);
  move(1.5, 0);
  move(0, -5.1);
  move(5, 0);
  assert.ok(Math.abs(position.x + 63.75) < .1 && position.y < .1,
    `stairs must be traversable downhill: ${JSON.stringify(position)}`);
  world.setGroundNavigation(createNavigator(world.doorSystem.navigationObstacles));
  const ground = { x: -63.75, y: 0, z: -78.85 };
  const gate = { x: -70.25, y: NANJING_WALL_WALK.height, z: NANJING_WEST_GATE_Z };
  const lower = { x: -65.8, z: -78.4, y: world.walkHeight(-65.8, -78.4, 8.58) };
  const turn = { x: -68.5, z: -79.2, y: NANJING_WALL_WALK.height / 2 };
  const upper = { x: -68.4, z: -76, y: world.walkHeight(-68.4, -76, 8.58) };
  for (const [start, goal] of [[ground, gate], [gate, ground], [lower, gate], [gate, lower],
    [upper, ground], [ground, upper], [turn, gate], [turn, ground], [lower, upper], [upper, lower]]) {
    const walker = new THREE.Vector3(start.x, start.y, start.z);
    const route = world.elevatedPath(start, goal);
    assert.ok(route?.length, `AI route missing: ${JSON.stringify({ start, goal })}`);
    for (const waypoint of route) {
      world.moveInfantry(walker, waypoint.x - walker.x, waypoint.z - walker.z, .42);
      assert.ok(Math.hypot(walker.x - waypoint.x, walker.z - waypoint.z) < .1 &&
        Math.abs(walker.y - waypoint.y) < .1, `route stalled at ${JSON.stringify(walker)}`);
    }
    assert.ok(Math.hypot(walker.x - goal.x, walker.z - goal.z) < .1 &&
      Math.abs(walker.y - goal.y) < .1);
  }
  for (const [low, high] of [
    [{ x: -63.95, z: -78.85 }, { x: -67.7, z: -78.85 }],
    [{ x: -68.75, z: -77.8 }, { x: -68.75, z: -74.05 }],
  ]) {
    const rise = world.walkHeight(high.x, high.z, NANJING_WALL_WALK.height) -
      world.walkHeight(low.x, low.z, NANJING_WALL_WALK.height);
    const slope = Math.atan2(rise, Math.hypot(high.x - low.x, high.z - low.z)) * 180 / Math.PI;
    assert.ok(slope > 48 && slope < 50, `unexpected stair slope: ${slope}`);
  }
});

test('Nanjing wall slogans preserve their text without adding collision or shot blockers', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const slogans = scene.children.filter(mesh => mesh.userData.nanjingFeature === 'wall-slogan');
  assert.deepEqual(slogans.map(mesh => mesh.userData.text), [
    '誓死保卫南京',
    '地无分南北，年无分老幼，无论何人，皆有守土抗战之责',
    '誓死保卫南京',
  ]);
  scene.updateMatrixWorld(true);
  for (const slogan of slogans) {
    const { width, height } = slogan.geometry.parameters;
    const west = slogan.rotation.y !== 0;
    const wall = west ? Math.abs(slogan.position.x + 74.2) < .05 &&
      slogan.position.z - width / 2 > -113 && slogan.position.z + width / 2 < NANJING_WEST_BREACH.minZ
      : NANJING_CITY_WALLS.find(bounds =>
      slogan.position.x - width / 2 >= bounds.minX &&
      slogan.position.x + width / 2 <= bounds.maxX &&
      Math.abs(slogan.position.z - bounds.maxZ) < .05);
    assert.ok(wall, 'slogan is on the outside of its wall');
    assert.ok(slogan.position.y - height / 2 > 0 && slogan.position.y + height / 2 < NANJING_WALL_WALK.height);
    assert.equal(world.solids.includes(slogan), false);
    const ray = new THREE.Raycaster(west
      ? new THREE.Vector3(slogan.position.x - 1, slogan.position.y, slogan.position.z)
      : new THREE.Vector3(slogan.position.x, slogan.position.y, slogan.position.z + 1),
    west ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1), 0, 2);
    assert.ok(ray.intersectObjects(world.solids).some(hit =>
      hit.object.userData.nanjingFeature === (west ? 'west-city-wall' : 'city-wall')),
      'the existing wall still blocks shots');
  }
  for (const [x, z] of [[-30, 31], [49, 34], [55, 30], [66, 34]])
    assert.equal(circleBlocked(x, z, .42, world.obstacles), false, 'the reviewed viewpoint is walkable');
});

test('dock north deployment reaches the city through both the ruined wall and the west gate', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const spawn = NANJING_SPAWNS.find(point => point.id === 'nanjing-west-dock');
  const positions = formationPositions(spawn, 11, world.obstacles);
  assert.equal(positions.length, 11);
  assert.ok(positions.every(point => point.z < NANJING_DOCK.z && point.x < NANJING_WEST_BREACH.minX));
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  for (const target of [{ x: -78, z: -89 }, { x: -78, z: NANJING_WEST_GATE_Z }]) {
    const path = navigate(positions[0], target);
    assert.ok(path.length, `cannot reach ${JSON.stringify(target)}: ${navigate.stats.reason}`);
    const walker = new THREE.Vector3(positions[0].x, 0, positions[0].z);
    for (const point of path) {
      world.moveInfantry(walker, point.x - walker.x, point.z - walker.z, .42);
      assert.ok(Math.hypot(walker.x - point.x, walker.z - point.z) < .1);
    }
    world.moveInfantry(walker, 12, 0, .42);
    assert.ok(walker.x > NANJING_WEST_BREACH.maxX, `crossing blocked at z=${target.z}`);
  }
  assert.ok(circleBlocked(-72, -84, .42, world.obstacles));
  assert.ok(circleBlocked(-72, -95, .42, world.obstacles));
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-78, 1.5, -89), new THREE.Vector3(1, 0, 0), 0, 12);
  assert.ok(!ray.intersectObjects(world.solids).some(hit =>
    hit.object.userData.nanjingFeature === 'west-city-wall'), 'the gap must not block shots');
  const names = scene.children.filter(object => object.userData.nanjingFeature === 'west-gate-name');
  assert.equal(names.length, 2);
  assert.ok(names.every(name => name.userData.text === '水西門' &&
    name.material.userData.lettering.order === 'right-to-left'));
  assert.equal(NANJING_WEST_GATE_HALF_WIDTH * 2, 6.8);
  assert.ok(circleBlocked(-72, NANJING_WEST_GATE_Z + 3.8, .42, world.obstacles));
  const ground = scene.children.find(object => object.userData.nanjingFeature === 'north-distant-ground');
  const bank = scene.children.find(object => object.userData.nanjingFeature === 'north-distant-bank');
  assert.ok(ground && bank);
  for (const z of [-109, -150, -250]) {
    const down = new THREE.Raycaster(new THREE.Vector3(-88, 2, z), new THREE.Vector3(0, -1, 0), 0, 3);
    assert.ok(down.intersectObject(ground).length, `missing northern terrain at z=${z}`);
  }
  assert.ok(scene.children.some(object => object.userData.nanjingFeature === 'north-distant-house'));
  assert.equal(world.solids.includes(ground), false);
  assert.equal(world.solids.includes(bank), false);
});

test('the west breach has a rendered and physically walkable rubble slope in both directions', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const slope = scene.children.find(object => object.userData.nanjingFeature === 'west-breach-slope');
  assert.ok(slope && world.solids.includes(slope));
  assert.ok(scene.children.some(object => object.userData.nanjingFeature === 'west-breach-rubble'));
  for (const [x, z] of [[-76, -89], [-74, -89], [-72, -89], [-70, -89], [-68, -89], [-72, -90]]) {
    const height = world.groundHeight(x, z);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0), 0, 4);
    const hit = ray.intersectObject(slope)[0];
    assert.ok(hit && Math.abs(hit.point.y - height) < .01, `rendered and walking heights disagree at ${x}, ${z}`);
  }
  assert.ok(world.groundHeight(-72, -89) > .7);
  for (const [start, direction] of [[-78, 1], [-66, -1]]) {
    const walker = new THREE.Vector3(start, 0, -89);
    let highest = 0;
    for (let step = 0; step < 60; step++) {
      const before = walker.x;
      world.moveInfantry(walker, direction * .2, 0, .42);
      assert.ok(Math.abs(walker.x - before - direction * .2) < .01, 'the slope must not block movement');
      assert.ok(Math.abs(walker.y - world.groundHeight(walker.x, walker.z)) < .001);
      highest = Math.max(highest, walker.y);
    }
    assert.ok(highest > .7, 'the soldier must actually climb the rubble');
    assert.ok(Math.abs(walker.y) < .001, 'the soldier returns to ground height');
  }
});

test('Nanjing has physical shell holes and smoke without persistent building flames', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  assert.equal(world.staticDamage.craters.length, 6);
  assert.equal(new Set(world.staticDamage.craters.map(crater => crater.radius)).size, 3);
  for (const crater of world.staticDamage.craters) {
    const ray = new THREE.Raycaster(new THREE.Vector3(crater.x, 3, crater.z), new THREE.Vector3(0, -1, 0));
    const ground = scene.children.filter(mesh => mesh.isMesh && !mesh.isInstancedMesh && !mesh.isSkinnedMesh);
    assert.ok(Math.abs(ray.intersectObjects(ground)[0].point.y + crater.depth) < .002);
    assert.ok(Math.abs(world.groundHeight(crater.x, crater.z) + crater.depth) < .002);
    for (const spawn of NANJING_SPAWNS)
      assert.ok(Math.hypot(crater.x - spawn.x, crater.z - spawn.z) > crater.radius * 1.35 + 9);
  }
  assert.ok(world.buildingFire.sources.length > 0);
  for (const low of [false, true]) {
    world.buildingFire.update(12.4, { low, smoke: true });
    assert.ok(world.buildingFire.snapshot.smoke > 0);
    assert.equal(world.buildingFire.snapshot.flames, 0);
    assert.equal(scene.getObjectByName('damaged-building-flames').visible, false);
    world.buildingFire.update(13, { low, smoke: false });
    assert.equal(world.buildingFire.snapshot.smoke, 0);
    assert.equal(world.buildingFire.snapshot.flames, 0);
  }
});

test('interior courtyard sandbags shield crouched defenders from grenade-height rays without blocking the gate lane', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const defenses = world.landmarks.gateInteriorDefenses;
  const bags = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'gate-interior-sandbag-collision');
  assert.equal(defenses.length, 4); assert.equal(bags.length, 48);
  const occluded = createOcclusionQuery();
  for (const defense of defenses) {
    const court = NANJING_COURTYARDS.find(court => defense.id.includes(court.id));
    assert.ok(defense.z < court.maxZ && defense.z - defense.depth > court.minZ);
    const start = new THREE.Vector3(defense.x, .5, defense.z + 1.5);
    const end = new THREE.Vector3(defense.x, .65, defense.z - 1.05);
    const direction = end.clone().sub(start), ray = new THREE.Raycaster(start, direction.normalize(), 0, start.distanceTo(end));
    assert.ok(occluded(ray, bags), 'actual blast occlusion query must find the sandbags');
    assert.ok(circleBlocked(defense.x, defense.z, .42, world.obstacles), 'the visual cover is not walk-through');
    assert.equal(circleBlocked(end.x, end.z, .42, world.obstacles), false, 'a crouched defender fits behind it');
    assert.ok(world.town.covers.some(cover => cover.id.startsWith(`forward-defense-${defense.id}-`)));
  }
  for (let z = NANJING_GATE_NORTH_EDGE - 1; z <= NANJING_GATE_SOUTH_EDGE + 1; z += .25)
    assert.equal(circleBlocked(0, z, .6, world.obstacles, 0, 1.75), false, `the main evacuation lane stays clear at ${z}`);
});

test('the Yangtze continues beyond the northern boundary and the city reuses Taierzhuang tree geometry', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const river = world.landmarks.rivers.find(river => river.id === 'yangtze-west');
  assert.ok(river.z - river.depth / 2 < -120);
  for (const z of [-96, -104, -107]) for (const x of [-73, -106, -109]) {
    assert.equal(circleBlocked(x, z, .42, world.obstacles), true, 'the northern edge is not a land bypass');
  }
  assert.ok(world.landmarks.trees.length >= 25);
  assert.ok(world.landmarks.trees.some(tree => tree.species === 'willow'));
  assert.ok(world.landmarks.trees.some(tree => tree.species === 'elm'));
  assert.ok(world.landmarks.trees.every(tree => Math.abs(tree.x) > 7));
  const views = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'city-tree');
  assert.ok(views.length >= world.landmarks.trees.length);
  assert.ok(views.every(mesh => mesh.geometry.attributes.color && mesh.position.y === -.16));
  for (const civilian of world.civilians) {
    const { x, z } = civilian.userData.waitingSlot;
    assert.deepEqual(civilian.userData.homeRoute.at(-1), { x, z });
    assert.deepEqual(civilian.userData.route.at(-1),
      civilian.userData.refugeeRestPoint ?? { x, z });
  }
});

test('autonomous wall assignments are reached from opening ground positions through both ramps without teleporting', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  const actors = nanjingBattleRoster().filter(formation => formation.team === 'friendly' && !formation.player && !formation.reserve)
    .flatMap(formation => {
      const spawn = NANJING_SPAWNS.find(point => point.id === formation.openingSpawnId);
      return formationPositions(spawn, 11, world.obstacles).map((position, index) => ({
        position: { ...position, y: 0 }, formation, index, health: 100, friendly: true, playerUnit: false, tactics: {},
      }));
    });
  assignNanjingDefense(actors, 0);
  for (const actor of actors) {
    const goal = nanjingDefenseGoal(actor), position = actor.position;
    const approach = goal.y > 7 ? nanjingWallEntryWaypoint(position, actor.tactics.nanjingDefense.side) : goal;
    const path = navigate(position, approach);
    assert.ok(path.length, `ground approach for ${actor.tactics.nanjingDefense.role}`);
    for (const point of path) {
      world.moveInfantry(position, point.x - position.x, point.z - position.z, .42);
      assert.ok(Math.hypot(point.x - position.x, point.z - position.z) < .05);
    }
    if (goal.y > 7) {
      const ascent = nanjingWallEntryWaypoint(position, actor.tactics.nanjingDefense.side);
      world.moveInfantry(position, ascent.x - position.x, ascent.z - position.z, .42);
      assert.ok(Math.abs(position.y - goal.y) < .02, `ramp ascent must actually raise the feet: ${JSON.stringify({ position, ascent, duty: actor.tactics.nanjingDefense })}`);
      const upperPath = world.elevatedPath(position, goal);
      assert.ok(upperPath?.length);
      for (const point of upperPath) world.moveInfantry(position, point.x - position.x, point.z - position.z, .42);
    }
    assert.ok(Math.hypot(position.x - goal.x, position.z - goal.z) < .05,
      `post arrival: ${JSON.stringify({ position, goal, duty: actor.tactics.nanjingDefense })}`);
    assert.equal(circleBlocked(goal.x, goal.z, .46, world.obstacles, goal.y), false);
  }
});

test('every residential door can be focused, opened, entered and closed using the shared door system', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const camera = new THREE.PerspectiveCamera();
  const ray = new THREE.Raycaster();
  for (const [index, home] of world.landmarks.residentialBuildings.entries()) {
    world.doorSystem.reset();
    const door = world.doorSystem.doors[index];
    assert.equal(door.id, `${home.id}-door`);
    assert.equal(door.state, door.initialAngle ? 'open' : 'closed');
    const length = Math.hypot(home.exit.x - door.x, home.exit.z - door.z);
    const nx = (home.exit.x - door.x) / length, nz = (home.exit.z - door.z) / length;
    const position = { x: door.x + nx * 1.2, y: 0, z: door.z + nz * 1.2 };
    if (door.state === 'open') {
      assert.equal(world.doorSystem.interact(door, position), true);
      for (let frame = 0; frame < 60; frame++) world.doorSystem.update(1 / 60, []);
    }
    assert.equal(door.state, 'closed', 'close initially open residential entrances before exercising their collision');
    camera.position.set(position.x, 1.65, position.z);
    camera.lookAt(door.x, 1.2, door.z);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    assert.equal(world.doorSystem.focus(camera)?.id, door.id);
    world.moveInfantry(position, -nx * 1.3, -nz * 1.3, .42);
    assert.ok((position.x - door.x) * nx + (position.z - door.z) * nz > .4, 'closed leaf blocks entry');
    assert.equal(world.doorSystem.interact(door, position), true);
    for (let frame = 0; frame < 60; frame++) world.doorSystem.update(1 / 60, []);
    assert.equal(door.state, 'open');
    scene.updateMatrixWorld(true);
    ray.set(new THREE.Vector3(door.x + nx, 1.2, door.z + nz), new THREE.Vector3(-nx, 0, -nz));
    ray.far = 2;
    const hits = ray.intersectObjects(world.solids, false);
    assert.equal(hits.length, 0, `${home.id}: open portal has no hidden solid face; ` +
      JSON.stringify(hits.map(hit => ({ feature: hit.object.userData.nanjingFeature,
        house: hit.object.userData.residentialId }))));
    for (let step = 0; step < 20; step++) world.moveInfantry(position, -nx * .1, -nz * .1, .42);
    assert.ok((position.x - door.x) * nx + (position.z - door.z) * nz < -.8, `player enters ${home.id}`);
    assert.equal(circleBlocked(home.x, home.z, .42, world.obstacles, 0), false);
    assert.equal(world.doorSystem.interact(door, position), true);
    for (let frame = 0; frame < 60; frame++) world.doorSystem.update(1 / 60, []);
    assert.equal(door.state, 'closed');
    scene.updateMatrixWorld(true);
    assert.ok(ray.intersectObjects(world.solids, false).length, 'closed door blocks shots');
  }
  world.doorSystem.reset();
  assert.ok(world.doorSystem.doors.every(door => door.state === (door.initialAngle ? 'open' : 'closed')),
    'reset restores each authored initial doorway state');
});

test('removing the northern gate also removes its courtyard, flanks and wall supports', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  assert.equal(world.landmarks.gatehouse.gates.length, 3);
  assert.equal(world.landmarks.courtyards.length, 2);
  assert.ok(NANJING_GATE_LENGTH < 35);
  for (const x of [0]) {
    assert.equal(circleBlocked(x, -17.2, .42, world.obstacles, 0), false);
    assert.equal(world.walkHeight(x, -17.2, 8.58), 0);
  }
  assert.equal(world.landmarks.soldierCave.z, NANJING_COURTYARDS[0].centerZ);
});

test('unrendered gate walls block tank sight, machine-gun rays and blast rays while the tunnel stays open', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const index = createSolidIndex(world.solids), ray = new THREE.Raycaster(), occluded = createOcclusionQuery();
  const blocked = (from, to) => {
    const direction = to.clone().sub(from).normalize(), distance = from.distanceTo(to);
    ray.set(from, direction); ray.far = distance - .04;
    return occluded(ray, index.candidates(from, direction, distance));
  };
  for (const height of [1, 1.8, 4, 8]) {
    assert.equal(blocked(new THREE.Vector3(7, height, 28), new THREE.Vector3(7, height, 12)), true);
    assert.equal(blocked(new THREE.Vector3(7, height, 21.23), new THREE.Vector3(7, height, 16)), true);
  }
  assert.equal(blocked(new THREE.Vector3(0, 1.8, 28), new THREE.Vector3(0, 1.8, 12)), false,
    'fire through the open tunnel is legitimate, unlike penetration of masonry');
});

test('wall paving has no overlapping coplanar top faces at gates, ramp cheeks or final treads', () => {
  const scene = new THREE.Scene();
  makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const meshes = scene.children.filter(object => object.isMesh), ray = new THREE.Raycaster();
  for (const x of [-21.5, 21.5, 0, 7]) for (const z of [-18.1, -6.1, 6.1, 18.1, 0, 12]) {
    ray.set(new THREE.Vector3(x, 8.7, z), new THREE.Vector3(0, -1, 0));
    const topFaces = ray.intersectObjects(meshes, true).filter(hit => Math.abs(hit.point.y - 8.58) < .001);
    assert.ok(new Set(topFaces.map(hit => hit.object)).size <= 1, `coplanar wall surfaces at ${x},${z}`);
  }
  const tops = meshes.filter(mesh => mesh.geometry.type === 'BoxGeometry' &&
    mesh.rotation.x === 0 && mesh.rotation.y === 0 && mesh.rotation.z === 0)
    .map(mesh => new THREE.Box3().setFromObject(mesh))
    .filter(bounds => Math.abs(bounds.max.y - NANJING_GATE_HEIGHT) < .001);
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    const a = tops[i], b = tops[j];
    const width = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
    const depth = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
    assert.ok(width < .001 || depth < .001,
      `overlapping wall-height boxes: ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
});

test('wall defenders can reach south-facing firing posts using elevated navigation instead of ground routes', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  for (const index of [0, 2, 5, 8, 10]) for (const x of [-21.5, 21.5]) for (const z of [-6, 0, 12]) {
    const position = { x, y: 8.58, z };
    for (let step = 0; step < 600; step++) {
      const goal = nanjingDefensePost(position, index, { x: 0 });
      assert.ok(world.elevatedPath(position, goal)?.length, `wall post route at ${JSON.stringify(position)}`);
      const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
      if (distance < .15 && goal.z === 19.9) break;
      if (distance > .01) world.moveInfantry(position, (goal.x - position.x) / distance * Math.min(.15, distance),
        (goal.z - position.z) / distance * Math.min(.15, distance), .42);
    }
    assert.ok(Math.hypot(position.x - (index - 5) * 1.65, position.z - 19.9) < .2, 'defender reaches the gate crown instead of standing idle');
    assert.equal(position.y, 8.58);
  }
});

test('wall defenders can rejoin the centreline from observed off-centre positions beside merlons', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  for (const [x, z] of [[22.368, 14.356], [23.868, 13.816], [23.852, 15.266],
    [22.229, -6.034], [18.217, 14.731], [7.755, 20.517]]) {
    const position = { x, y: 8.58, z };
    const goal = nanjingDefensePost(position, 5, { x: 0 });
    const path = world.elevatedPath(position, goal);
    assert.ok(path.length, `off-centre wall route at ${x},${z}`);
    for (const point of path) {
      for (let step = 0; step < 600; step++) {
        const distance = Math.hypot(point.x - position.x, point.z - position.z);
        if (distance < .02) break;
        world.moveInfantry(position, (point.x - position.x) / distance * Math.min(.1, distance),
          (point.z - position.z) / distance * Math.min(.1, distance), .42);
      }
      assert.ok(Math.hypot(point.x - position.x, point.z - position.z) < .02);
    }
  }
});

test('both rivers block wading and the stone bridge remains the only ground crossing', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  assert.ok(world.bridgeSurfaces.deck - world.riverSurfaces.water >= 1.8);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'bridge-stone-arch').length,
    world.landmarks.bridges.length * 3);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'bridge-pier').length,
    world.landmarks.bridges.length * 4);
  assert.equal('ford' in world.landmarks, false);
  assert.equal(world.solids.some(mesh => mesh.userData.nanjingFeature === 'shallow-ford-bed'), false);
  const position = { x: -54, y: 0, z: 70 };
  for (let step = 0; step < 200; step++) {
    world.moveInfantry(position, 0, -.2, .42);
  }
  assert.ok(position.z > 65, 'the former ford must stop infantry at the southern bank');
  for (const [x, z] of [[-54, 52], [0, 52], [-84 + NANJING_DOCK_SHIFT, -25],
    [-84 + NANJING_DOCK_SHIFT, -80], [-73.6 + NANJING_DOCK_SHIFT, -80]]) {
    assert.ok(circleBlocked(x, z, .42, world.obstacles), `deep water blocks ground movement at ${x},${z}`);
  }
  const dockPosition = { x: NANJING_DOCK.x, y: 0, z: NANJING_DOCK.z };
  for (let step = 0; step < 100; step++) world.moveInfantry(dockPosition, -.2, 0, .42);
  assert.ok(dockPosition.x > -73 + NANJING_DOCK_SHIFT, 'the accessible dock platform must not allow walking into the Yangtze');
  const infantry = createNavigator(world.doorSystem.navigationObstacles);
  const crossing = infantry({ x: -54, z: 70 }, { x: -54, z: 35 });
  assert.ok(crossing.length);
  assert.ok(crossing.some((point, index) => {
    const from = index ? crossing[index - 1] : { x: -54, z: 70 };
    if ((point.z - 52) * (from.z - 52) > 0 || point.z === from.z) return false;
    return Math.abs(from.x + (point.x - from.x) * (52 - from.z) / (point.z - from.z) + 24) < 5;
  }),
    'infantry from the former ford must detour across the bridge');
  const armor = createNavigator(world.armorObstacles, 1.5, 3.1);
  const path = armor({ x: -24, z: 92 }, { x: -24, z: 38 });
  assert.ok(path.length);
  assert.ok(path.some(point => Math.abs(point.x + 24) < 6), 'armor routes over the stone bridge');
  assert.equal(segmentClear({ x: -54, z: 70 }, { x: -54, z: 35 }, 3.1, world.armorObstacles), false);
});

test('river water is exposed in the rendered scene, with only stone bridges crossing it', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const surfaces = scene.children.filter(object => object.isMesh);
  const water = surfaces.filter(object => object.userData.nanjingFeature === 'river-water');
  assert.ok(water.length > 0 && water.every(surface => surface.geometry.attributes.position.count < 50000),
    'extended water must retain a bounded mesh rather than uniformly subdividing the whole river');
  for (const riverSurface of water) {
    const depth = riverSurface.geometry.getAttribute('waterDepth');
    assert.ok(depth && depth.count === riverSurface.geometry.attributes.position.count);
    let minDepth = Infinity, maxDepth = -Infinity;
    for (let index = 0; index < depth.count; index++) {
      const value = depth.getX(index);
      assert.ok(Number.isFinite(value) && value >= 0);
      minDepth = Math.min(minDepth, value); maxDepth = Math.max(maxDepth, value);
    }
    assert.ok(minDepth < .01 && maxDepth > 1, 'river vertices carry bank distance for animated shoreline foam');
    assert.ok(riverSurface.material.normalMap, 'river water uses the shared animated normal texture');
  }
  for (const [x, z] of [[0, 52], [-35, 52], [-84 + NANJING_DOCK_SHIFT, -25]]) {
    ray.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(surfaces, true)[0];
    assert.equal(hit?.object.userData.nanjingFeature, 'river-water',
      `water must not be hidden by terrain or an unbridged road at ${x},${z}`);
  }
  const bridge = world.landmarks.bridges[0];
  ray.set(new THREE.Vector3(bridge.x, 30, bridge.z), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObjects(surfaces, true)[0]?.object.userData.nanjingFeature, 'bridge-roadway');
  ray.set(new THREE.Vector3(-21.5, 10.2, 22),
    new THREE.Vector3(bridge.x + 21.5, .01 - 10.2, bridge.z - 22).normalize());
  assert.equal(ray.intersectObjects(surfaces, true)[0]?.object.userData.nanjingFeature, 'bridge-roadway',
    'the southern bridge should be visible from the southern wall walk');
  assert.ok(world.landmarks.residentialBuildings.length >= 20);
  assert.ok(world.landmarks.residentialBuildings.some(house => house.x < -30 && Math.abs(house.z) < 30));
  assert.ok(world.landmarks.residentialBuildings.some(house => house.x > 30 && Math.abs(house.z) < 30));
  assert.equal(world.doorSystem.doors.length, world.landmarks.residentialBuildings.length);
  for (const house of world.landmarks.residentialBuildings) {
    assert.ok(world.landmarks.rivers.every(river =>
      Math.abs(house.x - river.x) >= (house.width + river.width) / 2 + .4 ||
      Math.abs(house.z - river.z) >= (house.depth + river.depth) / 2 + .4),
    `house at ${house.x},${house.z} and its roof must stay on dry land`);
  }
});

test('river junction is continuous water without cross-channel embankments or stacked surfaces', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const banks = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'river-stone-bank');
  for (const [x, z] of [[-104, 40.5], [-104, 63.5], [-94.5, 52], [-93.5, 52], [-94.1, 52]]) {
    ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObjects(banks, false).length, 0, 'no masonry should divide the river junction');
    const hits = ray.intersectObjects(scene.children.filter(mesh => mesh.isMesh), false);
    const waterHits = hits.filter(hit => hit.object.userData.nanjingFeature === 'river-water');
    assert.equal(new Set(waterHits.map(hit => hit.object)).size, 1, 'water should have no overlapping level rectangles');
    assert.ok(Math.abs(waterHits[0].point.y - world.riverSurfaces.water) < .001);
  }
});

test('both rivers have varying shoreline bends while keeping bridge and dock openings', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  for (const riverId of ['qinhuai-south', 'yangtze-west']) {
    const banks = world.solids.filter(mesh => mesh.userData.riverId === riverId);
    assert.ok(banks.length > 30);
    assert.ok(new Set(banks.map(mesh => mesh.userData.shoreline.endInset.toFixed(2))).size > 15,
      'shoreline must not be a straight retaining wall');
    assert.ok(banks.every(mesh => mesh.userData.bankProfile === 'meandering-sloped-revetment'));
  }
  assert.equal(circleBlocked(-24, 40, .42, world.obstacles), false, 'bridge opening remains clear');
  assert.equal(circleBlocked(-54, 40, .42, world.obstacles), true, 'former ford is closed');
  assert.equal(circleBlocked(NANJING_DOCK.x, NANJING_DOCK.z, .42, world.obstacles), false);
});

test('bridge deck has no obstructing sandbags or stale cover targets while shore defenses remain', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  assert.equal(world.landmarks.bridgeDeckDefenses.length, 0);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature?.startsWith('bridge-deck-sandbag')).length, 0);
  assert.equal(world.town.covers.some(cover => cover.id.startsWith('bridge-deck-')), false);
  assert.ok(world.landmarks.forwardDefenses.some(defense => defense.id === 'bridge-west'));
  assert.ok(world.landmarks.forwardDefenses.some(defense => defense.id === 'bridge-east'));
  const bridge = world.landmarks.bridges[0];
  assert.equal(segmentClear({ x: bridge.x, z: 32 }, { x: bridge.x, z: 50 }, 3.1, world.obstacles), true,
    'full tank radius must fit the central bridge lane');
});

test('masonry uses physical-scale UVs and battlements have weathered brick, beveled edges and coping', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const wall = world.solids.find(mesh => mesh.userData.nanjingFeature === 'barbican-curtain-wall');
  const positions = wall.geometry.attributes.position, uv = wall.geometry.attributes.uv;
  assert.ok(Math.max(...Array.from({ length: uv.count }, (_, index) => uv.getX(index))) > 5,
    'long wall textures should repeat rather than stretch into giant boards');
  assert.ok(positions.count > 0);
  const battlements = world.solids.filter(mesh => mesh.userData.battlementFinish);
  assert.ok(battlements.length > 20);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'battlement-coping').length, battlements.length);
  for (const mesh of battlements) {
    assert.equal(mesh.userData.battlementFinish, 'weathered-beveled-brick');
    assert.equal(mesh.material.vertexColors, true);
    assert.ok(mesh.geometry.attributes.position.count > 24, 'bevels need more than the original cube faces');
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    assert.ok(bounds.min.x >= -.501 && bounds.max.x <= .501);
    assert.ok(bounds.min.y >= -.501 && bounds.max.y <= .501);
    assert.ok(bounds.min.z >= -.501 && bounds.max.z <= .501);
  }
});

test('Nanjing battlefield provides its own gate, river crossings, dock, ferries and civilian flow', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  assert.equal(world.objectives.map(point => point.name).join(' / '), '中华门第二道门内西侧 / 上新河渡口');
  assert.ok(world.civilians.some(civilian => civilian.userData.ageGroup === 'child'));
  assert.ok(world.civilians.some(civilian => civilian.userData.ageGroup === 'elderly'));
  assert.ok(world.civilians.some(civilian => civilian.userData.presentation === 'woman'));
  assert.ok(world.civilians.some(civilian => civilian.userData.presentation === 'man'));
  assert.ok(world.civilians.some(civilian => civilian.userData.carrying === 'luggage'));
  assert.ok(world.civilians.some(civilian => civilian.userData.carrying === 'child'));
  assert.ok(world.civilians.some(civilian => civilian.userData.carrying === 'none'));
  assert.ok(world.civilians.every(civilian => civilian.civilianArms.length === 2 &&
    civilian.civilianLegs.length === 2), 'civilian figures need articulated limbs for their walking animation');
  assert.ok(world.civilians.every(civilian => civilian.userData.civilianDetail?.face &&
    civilian.userData.civilianDetail?.layeredClothing &&
    civilian.userData.civilianDetail?.articulatedHands &&
    civilian.userData.civilianDetail?.componentCount >= 25 &&
    civilian.userData.civilianDetail?.renderParts === 1 &&
    civilian.userData.civilianDetail?.skinned &&
    civilian.userData.civilianDetail?.farTriangles < civilian.userData.civilianDetail?.nearTriangles * .35),
  'civilian figures need individual detail without multiplying render batches');
  assert.ok(world.civilians.every(civilian =>
    civilian.userData.civilianDetail.hands === 'palm-four-fingers-thumb' &&
    civilian.userData.civilianDetail.feet === 'shoe-sole-toe'));
  assert.equal(world.flags.length, 1, 'only the castle interior is a capture point; the dock is a mission location');
  assert.equal(world.ferries.length, 5);
  assert.equal(world.civilians.length, 180);
  const streetResidents = world.civilians.filter(person => person.userData.streetLife);
  assert.equal(streetResidents.length, 10);
  assert.equal(streetResidents.filter(person => person.visible).length, 5);
  assert.ok(streetResidents.every(person => !person.userData.active && !person.userData.arrived));
  assert.ok(streetResidents.every(person => person.userData.streetLife.route.length > 3));
  assert.ok(world.town.pieces.length >= 10);
  assert.ok(world.obstacles.length > 40);
  assert.equal(world.bridgeSurfaces.deck, 0);
  assert.equal(world.landmarks.gatehouse.style, 'arched-stone-gate');
  assert.equal(world.landmarks.gatehouse.gates.length, 3);
  assert.equal(world.landmarks.gatehouse.gates[2].opening, NANJING_GATE_TUNNEL.width);
  assert.ok(world.landmarks.gatehouse.gates.every(gate =>
    gate.depth === NANJING_GATE_TUNNEL.depth && gate.opening === NANJING_GATE_TUNNEL.width));
  assert.deepEqual(world.landmarks.gatehouse.footprint, {
    width: NANJING_GATE_WIDTH, length: NANJING_GATE_LENGTH, height: NANJING_GATE_HEIGHT,
  });
  assert.deepEqual(world.landmarks.gatehouse.sourceDimensionsMeters,
    { width: 118.5, length: 128, rampartHeight: 20.45, gatehouseHeight: 21.45 });
  assert.equal(world.landmarks.gatehouse.scale, NANJING_MAP_SCALE);
  assert.equal(world.landmarks.gatehouse.wallThickness, NANJING_RAMPART_THICKNESS);
  assert.deepEqual(world.landmarks.gatehouse.tunnel, NANJING_GATE_TUNNEL);
  assert.equal(world.landmarks.courtyards.length, 2);
  assert.deepEqual(world.landmarks.courtyards, NANJING_COURTYARDS);
  assert.equal(NANJING_COURTYARD_WIDTH, 18.88);
  assert.ok(NANJING_COURTYARDS.every(court => court.width === NANJING_COURTYARD_WIDTH &&
    court.minX === -NANJING_COURTYARD_HALF_WIDTH && court.maxX === NANJING_COURTYARD_HALF_WIDTH));
  assert.deepEqual(world.landmarks.flankingBuffers, NANJING_FLANKING_BUFFERS);
  assert.ok(NANJING_FLANKING_BUFFERS.every(buffer => buffer.width === NANJING_FLANKING_BUFFER_WIDTH &&
    Math.abs(buffer.maxX - buffer.minX - 9.86) < .001));
  assert.ok(NANJING_FLANKING_BUFFERS.some(buffer =>
    buffer.side < 0 && Math.abs(buffer.minX + 19.3) < .001 &&
    buffer.maxX === -NANJING_COURTYARD_HALF_WIDTH));
  assert.ok(NANJING_FLANKING_BUFFERS.some(buffer =>
    buffer.side > 0 && buffer.minX === NANJING_COURTYARD_HALF_WIDTH &&
    Math.abs(buffer.maxX - 19.3) < .001));
  assert.ok(Math.abs(NANJING_COURTYARD_WIDTH +
    NANJING_FLANKING_BUFFER_WIDTH * 2 + NANJING_RAMPART_THICKNESS * 2 - NANJING_GATE_WIDTH) < 1e-9);
  assert.equal(world.landmarks.flankingStructures.length, 4);
  assert.ok(world.landmarks.flankingStructures.every(structure => structure.openings.length > 0 &&
    structure.minX < structure.maxX && structure.minZ < structure.maxZ));
  assert.ok(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'flanking-masonry-core').length > 12);
  const internalLength = NANJING_RAMPART_THICKNESS + NANJING_GATE_TUNNEL.depth * 3 +
    NANJING_COURTYARDS.reduce((sum, court) => sum + court.depth, 0);
  assert.ok(Math.abs(internalLength - NANJING_GATE_LENGTH) < 1e-9);
  assert.ok(world.landmarks.courtyards.every(court =>
    court.minX >= -NANJING_GATE_WIDTH / 2 && court.maxX <= NANJING_GATE_WIDTH / 2 &&
    court.minZ >= NANJING_GATE_NORTH_EDGE && court.maxZ <= NANJING_GATE_SOUTH_EDGE));
  assert.equal(world.landmarks.soldierCaves.length, 21);
  assert.deepEqual(world.landmarks.soldierCaves, NANJING_SOLDIER_CAVES);
  assert.equal(world.landmarks.soldierCaves.filter(cave => cave.level === 'main-gate-level-1').length, 6);
  assert.equal(world.landmarks.soldierCaves.filter(cave => cave.level === 'main-gate-level-2').length, 7);
  assert.equal(world.landmarks.soldierCaves.filter(cave => cave.level === 'ramp').length, 8);
  assert.deepEqual([...new Set(world.landmarks.soldierCaves
    .filter(cave => cave.level === 'ramp').map(cave => cave.tier))].sort(), [1, 2, 3]);
  assert.deepEqual(world.landmarks.wallRamps, NANJING_WALL_RAMPS);
  assert.ok(world.landmarks.wallRamps[0].length > world.landmarks.wallRamps[1].length);
  assert.ok(world.landmarks.wallRamps[0].width > world.landmarks.wallRamps[1].width);
  assert.equal(world.landmarks.wallRamps[0].maxX, -NANJING_COURTYARD_HALF_WIDTH);
  assert.equal(world.landmarks.wallRamps[1].minX, NANJING_COURTYARD_HALF_WIDTH);
  assert.ok(NANJING_RAMPART_HEIGHT < NANJING_GATE_HEIGHT);
  assert.ok(world.landmarks.gatehouse.gates.every(gate =>
    gate.z - gate.depth / 2 >= NANJING_GATE_NORTH_EDGE &&
    gate.z + gate.depth / 2 <= NANJING_GATE_SOUTH_EDGE));
  assert.ok(world.landmarks.gatehouse.gates.every(gate => Math.abs(gate.x ?? 0) < .001));
  assert.equal(world.landmarks.bridges.length, 1);
  assert.deepEqual(world.landmarks.bridges[0], {
    x: -24, z: 52, width: 10, length: 44, axis: 'z', type: 'stone-bridge',
  });
  assert.deepEqual(world.landmarks.wallWalk, NANJING_WALL_WALK);
  assert.deepEqual(world.landmarks.wallWalks, NANJING_WALL_WALKS);
  assert.equal(NANJING_WALL_WALK.height, NANJING_GATE_HEIGHT);
  assert.ok(world.landmarks.wallWalk.maxX - world.landmarks.wallWalk.minX >= 4);
  const archFill = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'gate-above-arch-masonry');
  const expectedSlices = world.landmarks.gatehouse.gates.flatMap(gate =>
    casemateGateSlices(gate.z - gate.depth / 2, gate.z + gate.depth / 2));
  assert.equal(archFill.length, expectedSlices.length);
  for (const slice of expectedSlices) {
    assert.ok(archFill.some(mesh => {
      mesh.geometry.computeBoundingBox();
      return Math.abs(mesh.position.z + mesh.geometry.boundingBox.min.z - slice.minZ) < .001 &&
        Math.abs(mesh.position.z + mesh.geometry.boundingBox.max.z - slice.maxZ) < .001;
    }), `gate masonry must cover slice ${slice.minZ}..${slice.maxZ}`);
  }
  assert.ok(archFill.every(mesh => {
    mesh.geometry.computeBoundingBox();
    return Math.abs(mesh.geometry.boundingBox.max.y - NANJING_GATE_HEIGHT) < .01;
  }));
  assert.deepEqual(world.landmarks.soldierCave, NANJING_SOLDIER_CAVE);
  assert.deepEqual(world.landmarks.rivers.map(river => river.name), ['秦淮河南段', '长江']);
  assert.equal(world.landmarks.rivers.find(river => river.id === 'qinhuai-south').z, 52);
  assert.equal(world.landmarks.rivers.find(river => river.id === 'yangtze-west').x, NANJING_RIVER_SHORE_X - 12);
  assert.equal(world.impactHeight(-50,52),-1.9,'aircraft must contact the actual river level, not invisible ground above it');
  assert.ok(Math.abs(world.impactHeight(-84 + NANJING_DOCK_SHIFT,0)+.28)<1e-8);
  assert.equal(world.impactHeight(0,-50),world.groundHeight(0,-50));
  assert.equal(world.landmarks.primaryAssaultRoute, 'yuhua-road-bridge-through-jubaomen');
  assert.equal(world.outskirts.buildings.length, 0);
  assert.equal(world.doorSystem.doors.length, world.landmarks.residentialBuildings.length);
  const houses = world.landmarks.residentialBuildings;
  assert.deepEqual([...new Set(houses.map(house => house.floors))].sort(), [1, 2, 3, 4]);
  assert.ok(houses.every(house => house.width <= 9 && house.depth <= 9),
    'denser residential parcels stay within the nine-metre house limit');
  assert.ok(houses.filter(house => house.z < -60 || house.z > 65).every(house => house.floors === 1),
    'distant buildings should be small single-storey homes');
  assert.ok(!world.landmarks.rivers.some(river => river.id === 'qinhuai-north'),
    'the city district must have no internal river');
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'residential-roof-core').length,
    houses.length + houses.filter(house => house.damaged).length);
  const roofs = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'residential-tile-roof');
  assert.equal(roofs.length, houses.length);
  assert.ok(roofs.every(roof => roof.userData.roofStyle === 'taierzhuang-curved-tiles'));
  for (const house of houses) {
    const w = house.facing % 2 ? house.depth : house.width;
    const d = house.facing % 2 ? house.width : house.depth;
    for (const [front, back] of house.damaged ? [[-d / 2, -d / 2 + .24], [d / 2 - .24, d / 2]] : [[-d / 2, d / 2]]) {
      const a = housePoint(house, -w / 2, front), b = housePoint(house, house.damaged ? 0 : w / 2, back);
      const box = {
        minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
        minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
      };
      assert.ok(world.obstacles.some(obstacle => Math.abs(obstacle.minX - box.minX) < 1e-8 &&
        Math.abs(obstacle.maxX - box.maxX) < 1e-8 && Math.abs(obstacle.minZ - box.minZ) < 1e-8 &&
        Math.abs(obstacle.maxZ - box.maxZ) < 1e-8 && obstacle.height === house.height),
      'remaining roof masonry must match its actual supported volume');
    }
  }
  const rubble = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'gate-rubble');
  assert.equal(rubble.length, 22);
  assert.ok(rubble.every(mesh => Math.abs(mesh.position.y - mesh.scale.y / 2) < 1e-9));
  world.resetCampaign();
  assert.equal(world.aircraft.length, 3);
  for (const [index, model] of world.aircraft.entries()) {
    assert.ok(scene.children.includes(model));
    assert.equal(model.userData.profile.model, 'ki-10', 'Nanjing reuses the shared Japanese aircraft, not the Chinese I-15bis');
    assert.equal(model.userData.team, 'enemy');
    assert.equal(model.userData.attack.index, index);
    assert.equal(model.userData.attack.shots, 0);
    assert.equal(model.userData.gun.lastShot, null);
    assert.equal(model.userData.propeller.rotation.z, 0);
  }
  assert.notEqual(world.aircraft[0].userData.attack, world.aircraft[1].userData.attack);
  assert.notEqual(world.aircraft[0].userData.propeller, world.aircraft[1].userData.propeller);
  assert.equal(world.aircraft[0].children[0].geometry, world.aircraft[1].children[0].geometry);
});

test('dense city keeps streets between separate lots and mixes damaged homes with shops', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const homes = world.landmarks.residentialBuildings.filter(home => home.z < 0);
  assert.ok(homes.length >= 85, 'city should read as continuous blocks, not scattered houses');
  assert.ok(homes.filter(home => home.damaged).length >= homes.length * .6);
  assert.ok(homes.filter(home => home.use === 'shop').length >= 8);
  for (let first = 0; first < homes.length; first++) for (let second = first + 1; second < homes.length; second++) {
    const a = homes[first], b = homes[second];
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 1.8 ||
      Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2 + 1.8, 'lots must leave walkable alleys');
  }
  assert.ok(scene.children.some(mesh => mesh.userData.nanjingFeature === 'masonry-shell-pocks'));
  assert.ok(world.solids.some(mesh => mesh.userData.nanjingFeature === 'collapsed-house-rubble'));
});

test('wall-side blocks show open bomb-damaged roofs, dark flush scars and twelve valid smoke sources', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const homes = world.landmarks.residentialBuildings;
  assert.ok(homes.length >= 115, 'irregular streets retain a dense city despite wider route clearances');
  assert.ok(homes.filter(home => home.damaged).length >= 35);
  for (const side of [-1, 1]) {
    assert.ok(homes.filter(home => home.z > -10 && home.z < 10 && Math.sign(home.x) === side).length >= 8,
      'the inner faces of both city walls need inhabited blocks, not bare ground');
  }
  const roofMeshes = world.solids.filter(mesh => ['residential-tile-roof', 'residential-roof-core'].includes(mesh.userData.nanjingFeature));
  const ray = new THREE.Raycaster();
  for (const home of homes) {
    const point = housePoint(home, (home.facing % 2 ? home.depth : home.width) * .2,
      (home.facing % 2 ? home.width : home.depth) * .25);
    ray.set(new THREE.Vector3(point.x, home.height + 5, point.z),
      new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(roofMeshes, false).filter(hit => hit.point.y > home.height - .85);
    assert.equal(hits.length === 0, home.damaged, 'bomb holes must expose the interior, not a smaller intact gable');
  }
  const buildingSmoke = world.smoke.filter(puff => !puff.userData.homeId.startsWith('wall-damage-'));
  const wallSmoke = world.smoke.filter(puff => puff.userData.homeId.startsWith('wall-damage-'));
  assert.equal(buildingSmoke.length, 60);
  assert.equal(new Set(buildingSmoke.map(puff => puff.userData.homeId)).size, 12);
  assert.equal(wallSmoke.length, NANJING_WALL_PLUMES.length * 5);
  for (const puff of world.smoke) {
    assert.ok(['originX', 'originY', 'originZ', 'phase'].every(key => Number.isFinite(puff.userData[key])));
    if (buildingSmoke.includes(puff)) assert.ok(homes.find(home => home.id === puff.userData.homeId)?.damaged);
    assert.equal(puff.material.map.image.data[3], 0, 'smoke has a transparent edge, not a square billboard');
  }
  const scars = scene.children.find(mesh => mesh.userData.nanjingFeature === 'masonry-shell-pocks');
  assert.ok(scars.material.isMeshBasicMaterial && scars.material.transparent && !scars.material.depthWrite);
  assert.equal(scars.geometry.attributes.color.itemSize, 4);
  const colors = scars.geometry.attributes.color;
  for (let index = 0; index < colors.count; index++) assert.ok(colors.getX(index) < .02, 'scars must not be bright white chips');
});

test('later friendly reinforcements spawn inside the northern wall without moving opening defenses', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const spawn = NANJING_SPAWNS.find(point => point.id === 'nanjing-gate');
  assert.ok(spawn.z > world.landmarks.gatehouse.gates[0].z + NANJING_GATE_TUNNEL.depth / 2);
  assert.ok(spawn.z < 0);
  assert.equal(spawnBlockReason(spawn, 'infantry', [], world.obstacles), null);
  const positions = [];
  for (let squad = 0; squad < 3; squad++) {
    positions.push(...formationPositions(spawn, 11, world.obstacles, positions));
  }
  assert.equal(positions.length, 33, 'all three squads can replenish without overlapping each other');
  assert.ok(positions.every(point => point.z >= -2.5 && point.z <= 2.5 && Math.abs(point.x) <= 8.9));
  const roster = nanjingBattleRoster().filter(formation => formation.team === 'friendly' && !formation.reserve);
  assert.ok(roster.every(formation => formation.spawnId === 'nanjing-gate'));
  assert.ok(roster.every(formation => NANJING_SPAWNS.find(point => point.id === formation.openingSpawnId).z > 20));
  const capture = world.objectives.find(point => point.id === 'gate');
  assert.ok(capture.x < 0 && capture.z === NANJING_COURTYARDS[1].centerZ);
  assert.equal(circleBlocked(capture.x, capture.z, .42, world.obstacles), false);
  assert.ok(world.flags.some(flag => Math.abs(flag.position.x - capture.x - .9) < .001 &&
    flag.position.z === capture.z));
});

test('the northern counterattack spawn supports a full squad on real masonry and connects to both wall walks and ramps', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const spawn = NANJING_SPAWNS.find(point => point.id === 'nanjing-gate-north-wall');
  const enemies = [{ x: 2, z: 0, altitude: 0, health: 100 }];
  const ground = NANJING_SPAWNS.find(point => point.id === 'nanjing-gate');
  assert.match(spawnBlockReason(ground, 'infantry', enemies, world.obstacles), /附近有敌军/);
  assert.equal(spawnBlockReason(spawn, 'infantry', enemies, world.obstacles), null);
  const positions = formationPositions(spawn, 11, world.obstacles, [], enemies);
  for (const point of positions) {
    assert.equal(world.walkHeight(point.x, point.z, spawn.altitude), spawn.altitude);
    assert.equal(circleBlocked(point.x, point.z, .48, world.obstacles, spawn.altitude), false);
  }
  for (const walk of NANJING_WALL_WALKS) {
    const start = { ...positions[0], y: spawn.altitude };
    const goal = { x: (walk.minX + walk.maxX) / 2, z: 0, y: walk.height };
    const path = world.elevatedPath(start, goal);
    assert.ok(path.length);
    for (const waypoint of path) {
      world.moveInfantry(start, waypoint.x - start.x, waypoint.z - start.z, .42);
      assert.ok(Math.hypot(start.x - waypoint.x, start.z - waypoint.z) < .05);
    }
    for (let step = 0; step < 1000 && start.y > .24; step++) {
      const target = nanjingWallExitWaypoint(start);
      const dx = target.x - start.x, dz = target.z - start.z, distance = Math.hypot(dx, dz);
      if (distance < .001) continue;
      const travel = Math.min(distance, .15);
      world.moveInfantry(start, dx / distance * travel, dz / distance * travel, .42);
    }
    assert.ok(start.y <= .24, 'a respawned squad can descend and counterattack on the ground');
  }
});

test('shell breach has real passage, bullet clearance and no invisible wall-top support', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  for (const breach of world.landmarks.wallBreaches) {
    const x = (breach.minX + breach.maxX) / 2, z = (breach.minZ + breach.maxZ) / 2;
    const position = { x, y: 0, z: breach.minZ - 1 };
    world.moveInfantry(position, 0, breach.maxZ - position.z + 1, .42);
    assert.ok(position.z > breach.maxZ);
    assert.equal(world.walkHeight(x, z, NANJING_GATE_HEIGHT), 0);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 1.5, breach.minZ - 1),
      new THREE.Vector3(0, 0, 1), 0, breach.maxZ - breach.minZ + 2);
    assert.equal(ray.intersectObjects(world.solids, false).length, 0);
  }
});

test('continuous gate masonry seals the arch shoulders without overlapping tunnel blocks', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const walls = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'gate-above-arch-masonry');
  const radius = NANJING_GATE_TUNNEL.width / 2;
  const spring = NANJING_GATE_TUNNEL.height - radius;
  for (const [index, gate] of world.landmarks.gatehouse.gates.entries()) {
    for (const x of [-1.59, -.8, 0, .8, 1.59]) {
      const y = spring + Math.sqrt(radius * radius - x * x) + .08;
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, gate.z - gate.depth),
        new THREE.Vector3(0, 0, 1), 0, gate.depth * 2);
      assert.ok(ray.intersectObject(walls[index], false).length, `no sky leak above arch at ${x}`);
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.5, gate.z - gate.depth),
      new THREE.Vector3(0, 0, 1), 0, gate.depth * 2);
    assert.equal(ray.intersectObject(walls[index], false).length, 0, 'tunnel stays open');
  }
});

test('all eight initial Japanese infantry formations have a registered safe southern entry', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const roster = nanjingBattleRoster();
  const occupied = [];
  const hostiles = [];
  for (const formation of roster.filter(unit => unit.team === 'enemy' && unit.type === 'infantry')) {
    const spawn = NANJING_SPAWNS.find(point => point.id === formation.spawnId);
    assert.ok(spawn, `${formation.id} spawn exists`);
    assert.equal(spawnBlockReason(spawn, 'infantry', hostiles, world.obstacles), null, `${formation.id} spawn is clear`);
    let positions;
    try {
      positions = formationPositions(spawn, 11, world.obstacles, occupied, hostiles);
    } catch (error) {
      if (error instanceof FormationPlacementError) assert.fail(`${formation.id}: ${error.message}`);
      throw error;
    }
    occupied.push(...positions);
    assert.ok(positions.every(position =>
      position.x >= BATTLE_AREA.minX && position.x <= BATTLE_AREA.maxX &&
      position.z >= BATTLE_AREA.minZ && position.z <= BATTLE_AREA.maxZ),
      `${formation.id} squad stays inside the playable battle boundary`);
    hostiles.push(...positions.map(position => ({ ...position, altitude: 0, health: 100 })));
  }
  assert.equal(occupied.length, 88);
  assert.equal(roster.filter(unit => unit.assaultCrossing === 'bridge').length, 8);
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  for (const formation of roster.filter(unit => unit.team === 'enemy' && unit.type === 'infantry')) {
    const spawn = NANJING_SPAWNS.find(point => point.id === formation.spawnId);
    const path = navigate(spawn, { x: -24, z: 38 });
    assert.ok(path.length, `${formation.id} must reach the northern bridge landing`);
    assert.ok(path.some((point, index) => {
      const from = index ? path[index - 1] : spawn;
      if ((point.z - 52) * (from.z - 52) > 0 || point.z === from.z) return false;
      return Math.abs(from.x + (point.x - from.x) * (52 - from.z) / (point.z - from.z) + 24) < 5;
    }),
      `${formation.id} must use the bridge, not deep water`);
  }
});

test('all three starting Chinese squads fit the gate-to-bridge sandbag positions and elevated spaces remain walkable', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const roster = nanjingBattleRoster();
  const occupied = [];
  for (const formation of roster.filter(unit => unit.team === 'friendly' && !unit.reserve)) {
    const spawn = NANJING_SPAWNS.find(point => point.id === formation.openingSpawnId);
    assert.ok(spawn, `${formation.id} spawn exists`);
    assert.equal(spawnBlockReason(spawn, 'infantry', [], world.obstacles), null, `${formation.id} spawn is clear`);
    const positions = formationPositions(spawn, 11, world.obstacles, occupied);
    assert.ok(positions.every(position => position.z >= 23 && position.z <= 30 && Math.abs(position.x) <= 21));
    occupied.push(...positions);
  }
  assert.equal(occupied.length, 33);
  assert.equal(world.landmarks.forwardDefenses.length, 6);
  assert.ok(scene.children.filter(mesh => mesh.userData.sandbagStyle === 'taierzhuang-detailed').length >= 280);
  assert.ok(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'forward-sandbag-collision').length >= 280);
  const wallSpawn = NANJING_SPAWNS.find(spawn => spawn.layout === 'wall');
  assert.equal(world.walkHeight(wallSpawn.x, wallSpawn.z, wallSpawn.altitude), wallSpawn.altitude);
  const westWalk = NANJING_WALL_WALKS[0];
  assert.equal(world.walkHeight((westWalk.minX + westWalk.maxX) / 2, 0, westWalk.height), westWalk.height);
  const wallPositions = formationPositions(wallSpawn, 11, world.obstacles);
  assert.ok(wallPositions.every(position => Math.abs(world.walkHeight(position.x, position.z, wallSpawn.altitude) - wallSpawn.altitude) < .01));
  const caveSpawn = NANJING_SPAWNS.find(spawn => spawn.layout === 'cave');
  assert.equal(spawnBlockReason(caveSpawn, 'infantry', [], world.obstacles), null);
  const cavePositions = formationPositions(caveSpawn, 11, world.obstacles);
  assert.ok(cavePositions.every(position => Math.abs(world.walkHeight(position.x, position.z, caveSpawn.altitude) - caveSpawn.altitude) < .01));
});

test('bridge-side sandbags match the Taierzhuang cover mesh and leave usable firing slots and a tank lane', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const bags = scene.children.filter(object => object.userData.sandbagStyle === 'taierzhuang-detailed');
  const visuals = bags.filter(object => object.userData.nanjingFeature === 'forward-sandbag');
  assert.equal(visuals.length, 288);
  assert.ok(visuals.every(object => object.geometry === bags[0].geometry &&
    Math.abs(object.scale.x - .59) < .02 && Math.abs(object.scale.y - .23) < .02 &&
    Math.abs(object.scale.z - .44) < .02));
  assert.ok(new Set(visuals.map(object => object.rotation.y)).size > 10, 'sandbags should not share a rigid identical angle');
  assert.ok(world.landmarks.forwardDefenses.some(defense => defense.id === 'bridge-west'));
  assert.ok(world.landmarks.forwardDefenses.some(defense => defense.id === 'bridge-east'));
  const bridgeCovers = world.town.covers.filter(slot => slot.id.startsWith('forward-defense-bridge-'));
  assert.equal(bridgeCovers.length, 4);
  for (const slot of bridgeCovers) {
    assert.equal(circleBlocked(slot.x, slot.z, .42, world.obstacles), false, `${slot.id} must fit a soldier`);
    for (const height of [.35, .65, 1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(slot.x, height, 48), new THREE.Vector3(0, 0, -1));
      ray.far = 48 - slot.z;
      assert.ok(ray.intersectObjects(visuals, false).length, `${slot.id} blocks the bridge-facing firing line at ${height}m`);
    }
  }
  assert.equal(segmentClear({ x: -24, z: 76 }, { x: -24, z: 30 }, 3.1, world.armorObstacles),
    true, 'sandbags must leave the bridge centre clear for the tank');
});

test('infantry can walk up the ramp and across the connected wall tops without jumping', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  let westTop = null;
  for (const ramp of NANJING_WALL_RAMPS) {
    const ascendingX = ramp.side < 0 ? ramp.maxX : ramp.minX;
    const descendingX = ramp.side < 0 ? ramp.minX : ramp.maxX;
    const direction = descendingX - ascendingX;
    const position = { x: ascendingX, z: ramp.centerZ, y: world.walkHeight(ascendingX, ramp.centerZ) };
    world.moveInfantry(position, direction, 0, .42);
    assert.ok(position.y >= ramp.height - .02, `${ramp.id} ramp should reach the wall top, got ${position.y}`);
    assert.ok(Math.abs(position.x - descendingX) < .1,
      `${ramp.id} ramp should not be blocked at the wall, got x=${position.x}`);
    if (ramp.side < 0) westTop = position;
  }

  const ramp = NANJING_WALL_RAMPS[0];
  const wallWalk = NANJING_WALL_WALKS[0];
  const position = westTop;
  const wallCenterX = (wallWalk.minX + wallWalk.maxX) / 2;
  world.moveInfantry(position, wallCenterX - position.x, 0, .42);
  assert.ok(Math.abs(position.x - wallCenterX) < .1, 'ramp should connect to the center of the wall walk');
  const startZ = position.z;
  const northEnd = wallWalk.minZ + .3;
  world.moveInfantry(position, 0, northEnd - position.z, .42);
  assert.ok(position.z < startZ - 4, `wall top should remain passable across the gates, got z=${position.z}`);
  assert.ok(Math.abs(position.z - northEnd) < .1, `wall top should reach the new north end, got z=${position.z}`);
  assert.ok(Math.abs(position.y - ramp.height) < .02);
});

test('both wall walks connect to the flanking rooftops and every gate crown', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  for (const side of [-1, 1]) {
    const wall = NANJING_WALL_WALKS.find(walk => Math.sign(walk.minX) === side);
    const wallX = (wall.minX + wall.maxX) / 2;
    const southEnd = wall.maxZ - .3, northEnd = wall.minZ + .3;
    const alongWall = { x: wallX, z: southEnd, y: wall.height };
    world.moveInfantry(alongWall, 0, northEnd - southEnd, .42);
    assert.ok(Math.abs(alongWall.z - northEnd) < .02, 'solid battlements must not block the continuous wall passage');
    world.moveInfantry(alongWall, 0, southEnd - northEnd, .42);
    assert.ok(Math.abs(alongWall.z - southEnd) < .02, 'wall passage must also work southbound through the main gate');
    for (const courtyard of NANJING_COURTYARDS) {
      const position = { x: wallX, z: courtyard.centerZ, y: wall.height };
      const roofX = side * (NANJING_COURTYARD_HALF_WIDTH + 2);
      world.moveInfantry(position, roofX - position.x, 0, .42);
      assert.ok(Math.abs(position.x - roofX) < .02, `${side}/${courtyard.id}: rooftop should be reachable`);
      assert.ok(Math.abs(position.y - wall.height) < .02, 'rooftop should be flush with wall walk');
      world.moveInfantry(position, wallX - position.x, 0, .42);
      assert.ok(Math.abs(position.x - wallX) < .02, 'return to wall should not require jumping');
    }
  }
  for (const gate of world.landmarks.gatehouse.gates) {
    const position = { x: -21.5, z: gate.z, y: NANJING_WALL_WALK.height };
    world.moveInfantry(position, 43, 0, .42);
    assert.ok(Math.abs(position.x - 21.5) < .02, 'gate crown should link the east and west walls');
    assert.equal(position.y, NANJING_WALL_WALK.height);
  }
  for (const merlon of world.solids.filter(mesh => ['wall-merlon', 'curtain-merlon', 'gate-tower-crenel']
    .includes(mesh.userData.nanjingFeature))) {
    assert.ok(world.obstacles.some(obstacle =>
      Math.abs((obstacle.minX + obstacle.maxX) / 2 - merlon.position.x) < .001 &&
      Math.abs((obstacle.minZ + obstacle.maxZ) / 2 - merlon.position.z) < .001 &&
      Math.abs(obstacle.height - merlon.position.y - merlon.scale.y / 2) < .001),
    'visible battlements should have collision, not be walk-through decoration');
  }
});

test('both ramps have grounded masonry steps and are approachable and reversible from the courtyard', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  for (const ramp of NANJING_WALL_RAMPS) {
    const treads = world.solids.filter(mesh => mesh.userData.nanjingFeature === `${ramp.id}-wall-stair-tread`);
    assert.ok(treads.length > 0);
    assert.ok(treads.every(mesh => Math.abs(mesh.position.y - mesh.scale.y / 2) < .001),
      'stone steps should be supported down to the ground, not floating plates');
    const position = { x: 0, z: ramp.centerZ, y: 0 };
    const wallX = ramp.side * 21.5;
    world.moveInfantry(position, wallX, 0, .42);
    assert.ok(Math.abs(position.x - wallX) < .02, `${ramp.id}: complete approach should reach wall`);
    assert.ok(Math.abs(position.y - ramp.height) < .02);
    world.moveInfantry(position, -wallX, 0, .42);
    assert.ok(Math.abs(position.x) < .02, `${ramp.id}: descent should return to courtyard`);
    assert.ok(Math.abs(position.y) < .02);
  }
});

test('the Japanese bridge approach reaches the west-side second-gate objective, and all tunnels and the cave stay accessible', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  const position = { x: -24, z: 84, y: 0 };
  const stops = [
    { x: -24, z: 38 },
    ...[...world.landmarks.gatehouse.gates].reverse().slice(0, 2).map(gate => ({ x: 0, z: gate.z - gate.depth / 2 - .8 })),
    { x: world.objectives[0].x, z: world.objectives[0].z },
    { x: 0, z: NANJING_COURTYARDS[1].centerZ },
    { x: 0, z: world.landmarks.gatehouse.gates[0].z - NANJING_GATE_TUNNEL.depth / 2 - .8 },
    { x: 0, z: NANJING_SOLDIER_CAVE.z },
    { x: NANJING_SOLDIER_CAVE.x, z: NANJING_SOLDIER_CAVE.z },
  ];
  for (const stop of stops) {
    const path = navigate(position, stop);
    assert.ok(path.length, `assault route must be navigable: ${JSON.stringify(stop)} (${navigate.stats.reason})`);
    for (const waypoint of path) {
      world.moveInfantry(position, waypoint.x - position.x, waypoint.z - position.z, .42);
      assert.ok(Math.hypot(position.x - waypoint.x, position.z - waypoint.z) < .05,
        'planned assault path must also pass physical movement collision');
    }
    assert.ok(Math.hypot(position.x - stop.x, position.z - stop.z) < .05);
  }
  assert.equal(position.y, NANJING_SOLDIER_CAVE.floorHeight);
  world.moveInfantry(position, -NANJING_SOLDIER_CAVE.x, 0, .42);
  assert.ok(Math.abs(position.x) < .02, 'cave occupants must be able to leave through the entrance');
  assert.equal(position.y, 0);
});

test('dock planking is visual-only and preserves the actual deck and ferry access', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  let planking;
  scene.traverse(object => { if (object.userData.nanjingFeature === 'dock-planked-detail') planking = object; });
  assert.ok(planking);
  assert.ok(!world.solids.includes(planking));
  assert.ok(!world.obstacles.includes(planking));
  assert.ok(planking.geometry.attributes.position.array.every(Number.isFinite));
  assert.ok(planking.geometry.index.count / 3 < 20000);
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(planking);
  assert.ok(bounds.min.x >= -73.03 + NANJING_DOCK_SHIFT && bounds.max.x <= -59 + NANJING_DOCK_SHIFT);
  assert.ok(bounds.min.z >= -82.5 && bounds.max.z <= -77.5);
  assert.ok(bounds.max.x - bounds.min.x > 2.5 * (bounds.max.z - bounds.min.z), 'the jetty is long and narrow');
  assert.ok(bounds.max.y < .37);
  assert.ok(NANJING_RIVER_SHORE_X - (NANJING_DOCK.x - 7) >= 10, 'the pier projects into real water');
  assert.equal(world.isDeepWater(NANJING_DOCK.x, NANJING_DOCK.z), false, 'the deck remains walkable above water');
  assert.equal(world.isDeepWater(NANJING_DOCK.x, NANJING_DOCK.z - 13), true, 'adjacent open water stays impassable');
  const waterRay = new THREE.Raycaster(new THREE.Vector3(NANJING_DOCK.x, 3, NANJING_DOCK.z), new THREE.Vector3(0, -1, 0));
  assert.ok(waterRay.intersectObjects(scene.children.filter(object => object.isMesh), false)
    .some(hit => hit.object.userData.nanjingFeature === 'river-water'), 'water is actually rendered below the pier');
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-pile').length, 10);
  const sign = world.solids.find(mesh => mesh.userData.nanjingFeature === 'dock-entry-sign');
  assert.equal(sign.userData.text, '上新河渡口');
  assert.ok(sign.position.y - sign.scale.y / 2 > 3, 'the raised sign leaves the entrance clear');
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-entry-roof').length, 2);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-fence-post').length, 22);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-fence-rail').length, 8);
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-fence-slat').length, 52);
  for (const side of [-1, 1]) {
    for (let offset = 5; offset <= 10; offset += .5) {
      assert.ok(circleBlocked(NANJING_DOCK_ENTRY_X, NANJING_DOCK.z + side * offset, .42, world.obstacles),
        `the city-facing fence blocks passage at ${side * offset}`);
    }
    for (let x = NANJING_RIVER_SHORE_X; x <= NANJING_DOCK_ENTRY_X; x += .5) {
      assert.ok(circleBlocked(x, NANJING_DOCK.z + side * 10, .42, world.obstacles),
        `the return fence blocks passage at ${x}`);
    }
  }
  const outerBags = scene.children.filter(mesh => mesh.userData.nanjingFeature === 'dock-outer-sandbag');
  assert.equal(outerBags.length, 36);
  assert.ok(outerBags.every(bag => Math.abs(bag.position.x - (NANJING_DOCK_ENTRY_X + 1)) < .04),
    'the outer sandbag line is approximately one metre in front of the fence');
  const entrance = { x: NANJING_DOCK_ENTRY_X + 4, y: 0, z: NANJING_DOCK.z };
  world.moveInfantry(entrance, -8, 0, .42);
  assert.ok(entrance.x < NANJING_DOCK_ENTRY_X - 1, 'the gate opening permits physical entry');
  for (const ferry of world.ferries) {
    const { shore } = ferryBoardingPoints(ferry);
    assert.equal(world.groundHeight(shore.x, shore.z), .36);
    const ray = new THREE.Raycaster(new THREE.Vector3(shore.x, .39, shore.z), new THREE.Vector3(0, -1, 0), 0, .1);
    assert.ok(ray.intersectObjects(world.solids, false).some(hit => Math.abs(hit.point.y - .36) < 1e-5));
  }
  assert.deepEqual(world.ferries.map(ferry => [ferry.position.x, ferry.position.z]),
    NANJING_FERRY_BERTHS.map(berth => [berth.x, berth.z]));
});

test('northwest dock, boats and civilian route stay accessible behind the connected western city wall', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  assert.ok(NANJING_DOCK.x < -60 && NANJING_DOCK.z < -70);
  assert.deepEqual(world.landmarks.cityWalls, NANJING_CITY_WALLS);
  assert.equal(NANJING_CITY_WALLS[0].maxX, -NANJING_GATE_WIDTH / 2);
  const [west, northbound, east] = NANJING_CITY_WALLS;
  assert.equal(west.minX, northbound.minX);
  assert.equal(northbound.maxZ, west.minZ, 'western wall must turn north without leaving a gap');
  assert.equal(east.minX, NANJING_GATE_WIDTH / 2, 'eastern wall must connect to the opposite gate flank');
  assert.equal(east.minZ, west.minZ);
  assert.ok(east.maxX >= 100 && northbound.minZ === NANJING_WEST_GATE_Z + NANJING_WEST_GATE_HALF_WIDTH);
  assert.ok(Math.abs(NANJING_DOCK.z - NANJING_WEST_GATE_Z) >= 20, 'the dock lies diagonally beyond the west gate');
  assert.ok(circleBlocked(-72, -112, .42, world.obstacles), 'the west and north walls meet');
  assert.ok(circleBlocked(-72, -84, .42, world.obstacles), 'the extended west wall remains solid outside the breach');
  const gateCrossing = { x: -78, y: 0, z: NANJING_WEST_GATE_Z };
  world.moveInfantry(gateCrossing, 12, 0, .42);
  assert.ok(gateCrossing.x > -70, 'the west gate admits infantry without crossing the wall');
  assert.ok(world.landmarks.residentialBuildings.filter(home => home.x < -76 && home.x > -92).length >= 4);
  assert.deepEqual(NANJING_EMPLACEMENTS.filter(point => ['dock-mg', 'dock-gun', 'dock-aa'].includes(point.id))
    .map(point => [point.id, point.x, point.z]), [
    ['dock-mg', -53.5, -92], ['dock-gun', -63, -94], ['dock-aa', -68, -71],
  ]);
  assert.equal(world.groundHeight(-68, -71), .36, 'the unchanged AA gun remains physically supported');
  assert.ok(world.solids.some(mesh => mesh.userData.nanjingFeature === 'dock-aa-platform'));
  const wallMeshes = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'city-wall');
  assert.equal(wallMeshes.length, NANJING_CITY_WALLS.length + world.landmarks.wallBreaches.length);
  for (const wall of NANJING_CITY_WALLS) {
    const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2;
    assert.ok(circleBlocked(x, z, .42, world.obstacles), 'the city wall must physically block ground movement');
    assert.equal(world.walkHeight(x, z, NANJING_GATE_HEIGHT), NANJING_GATE_HEIGHT);
  }
  assert.deepEqual(world.ferries.map(ferry => [ferry.position.x, ferry.position.z]),
    NANJING_FERRY_BERTHS.map(berth => [berth.x, berth.z]));
  assert.equal(world.landmarks.dockDefenses.length, 8);
  assert.ok(['west-gate-north', 'west-gate-south'].every(id =>
    world.landmarks.dockDefenses.some(defense => defense.id === id)));
  const dockBags = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-sandbag-collision');
  for (const bag of dockBags) bag.updateWorldMatrix(true, false);
  assert.ok(dockBags.length >= 90, 'three approach directions need layered physical cover');
  const platformBags = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-platform-sandbag-collision');
  assert.equal(platformBags.length, 24);
  for (const bag of platformBags) bag.updateWorldMatrix(true, false);
  for (const z of [-89.4, -70.6]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(-92, .55, z + (z < -80 ? 2 : -2)),
      new THREE.Vector3(0, 0, z < -80 ? -1 : 1), 0, 4);
    assert.ok(ray.intersectObjects(platformBags, false).length, 'platform sandbags physically shield the player');
  }
  assert.ok(world.town.covers.filter(cover => cover.id.startsWith('forward-defense-dock')).length >= 4);
  const ray = new THREE.Raycaster();
  for (const id of ['dock-original-north', 'dock-original-south', 'dock-east-north', 'dock-east-south']) {
    const defense = world.landmarks.dockDefenses.find(defense => defense.id === id);
    const cover = world.town.covers.find(cover => cover.id.startsWith(`forward-defense-${id}-`));
    const yaw = defense.yaw ?? 0;
    const from = new THREE.Vector3(cover.x, .55, cover.z);
    const direction = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    ray.set(from, direction);
    assert.ok(ray.intersectObjects(dockBags, false).some(hit => hit.distance < 3),
      `${id} must block shots from its assault direction`);
  }
  const outerBags = world.solids.filter(mesh => mesh.userData.nanjingFeature === 'dock-outer-sandbag-collision');
  assert.equal(outerBags.length, 36);
  for (const bag of outerBags) bag.updateWorldMatrix(true, false);
  for (const side of [-1, 1]) {
    const z = NANJING_DOCK.z + side * 7.26;
    ray.set(new THREE.Vector3(NANJING_DOCK_ENTRY_X + 3, .55, z), new THREE.Vector3(-1, 0, 0));
    ray.far = 4;
    assert.ok(ray.intersectObjects(outerBags, false).length, 'the outer sandbag wall blocks fire');
  }
  assert.ok(new Set(world.civilians.map(civilian => civilian.userData.homeId)).size >= 10,
    'residents must evacuate from homes across the district, not one spawn line');
  for (const civilian of world.civilians) {
    const position = civilian.position.clone();
    const home = world.landmarks.residentialBuildings.find(house => house.id === civilian.userData.homeId);
    assert.equal(home.floors, 1, 'residents leave individual single-storey homes');
    if (civilian.userData.openingWave) {
      assert.ok(position.z >= 39 && position.z <= 64 && Math.abs(position.x + 24) <= 2.2,
        'opening refugees start on the southern stone bridge, before the gate');
      assert.ok(civilian.userData.route.some(point => Math.abs(point.x) < 1 && point.z < -8),
        'opening refugees actually pass through the gate before joining the evacuation route');
    } else if (civilian.userData.streetLife) {
      assert.deepEqual({ x: position.x, z: position.z }, civilian.userData.streetLife.initialPosition);
      // Door traversal and rebasing from street positions are exercised by civilian-street-life.test.js.
      position.set(home.exit.x, 0, home.exit.z);
    } else assert.deepEqual({ x: position.x, z: position.z }, home.exit);
    const data = civilian.userData;
    const route = data.openingWave ? [...data.refugeeRestRoute, ...data.refugeeResumeRoute] : data.route;
    for (const waypoint of route) {
      world.moveInfantry(position, waypoint.x - position.x, waypoint.z - position.z, .3);
      assert.ok(Math.hypot(position.x - waypoint.x, position.z - waypoint.z) < .05,
        `civilian route must not cross houses, walls or closed riverbanks: ${JSON.stringify(position)}`);
    }
    const slot = civilian.userData.waitingSlot;
    assert.ok(Math.hypot(position.x - slot.x, position.z - slot.z) < .05);
  }
  for (const spawn of NANJING_SPAWNS.filter(point => point.id.startsWith('nanjing-west'))) {
    assert.equal(spawnBlockReason(spawn, 'infantry', [], world.obstacles), null, spawn.id);
  }
  const armorNavigate = createNavigator(world.obstacles, 1.5, 3.1);
  const approach = { x: -78, z: -66 };
  assert.ok(armorNavigate({ x: 90, z: -93 }, approach).length,
    'second-stage armor must reach the landward approach outside the fenced yard');
});

test('withdrawing wall squads can descend both ramps before using ground navigation to the dock', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  for (const walk of NANJING_WALL_WALKS) for (const court of NANJING_COURTYARDS) {
    const position = { x: (walk.minX + walk.maxX) / 2, z: court.centerZ, y: walk.height };
    for (let step = 0; step < 1000 && position.y > .24; step++) {
      const target = nanjingWallExitWaypoint(position);
      assert.ok(target);
      const dx = target.x - position.x, dz = target.z - position.z;
      const distance = Math.hypot(dx, dz);
      const travel = Math.min(distance, .15);
      world.moveInfantry(position, dx / distance * travel, dz / distance * travel, .42);
    }
    assert.ok(position.y <= .24, `wall squad must get off the wall (${JSON.stringify(position)})`);
    const dock = NANJING_DOCK;
    const path = navigate(position, dock);
    assert.ok(path.length, 'wall descent must connect to the ground-level withdrawal route');
    for (const waypoint of path) {
      for (let frame = 0; frame < 1000; frame++) {
        const dx = waypoint.x - position.x, dz = waypoint.z - position.z, distance = Math.hypot(dx, dz);
        if (distance < .02) break;
        const travel = Math.min(distance, .12);
        world.moveInfantry(position, dx / distance * travel, dz / distance * travel, .42);
      }
      assert.ok(Math.hypot(position.x - waypoint.x, position.z - waypoint.z) < .05,
        `withdrawal route stopped at ${JSON.stringify(position)} before ${JSON.stringify(waypoint)}`);
    }
    assert.ok(Math.hypot(position.x - dock.x, position.z - dock.z) < .05);
  }
});

test('all three dock assault directions have safe squad deployment and navigable ground routes', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  const occupied = [];
  assert.equal(NANJING_DOCK_ASSAULT_SPAWNS.length, 8);
  assert.equal(new Set(NANJING_DOCK_ASSAULT_SPAWNS.map(id => id.split('-')[1])).size, 3);
  for (const id of NANJING_DOCK_ASSAULT_SPAWNS) {
    const spawn = NANJING_SPAWNS.find(point => point.id === id);
    assert.equal(spawnBlockReason(spawn, 'infantry', [], world.obstacles), null, id);
    const positions = formationPositions(spawn, 11, world.obstacles, occupied);
    occupied.push(...positions);
    const position = { ...positions[0], y: 0 };
    const path = navigate(position, NANJING_DOCK);
    assert.ok(path.length, `${id} must reach dock (${navigate.stats.reason})`);
    for (const waypoint of path) {
      world.moveInfantry(position, waypoint.x - position.x, waypoint.z - position.z, .42);
      if (Math.hypot(position.x - waypoint.x, position.z - waypoint.z) >= .05) {
        world.moveInfantry(position, waypoint.x - position.x, waypoint.z - position.z, .42);
      }
      assert.ok(Math.hypot(position.x - waypoint.x, position.z - waypoint.z) < .05);
    }
  }
  const armorNavigate = createNavigator(world.obstacles, 1.5, 3.1);
  for (const [start, goal] of [
    [{ x: -24, z: 92 }, { x: -24, z: 38 }],
    [{ x: -24, z: 38 }, { x: 0, z: 28 }],
    [{ x: 90, z: -93 }, { x: NANJING_DOCK.x + 5, z: NANJING_DOCK.z }],
  ]) {
    assert.ok(armorNavigate(start, goal).length,
      `bridge landings must provide full tank turning clearance: ${JSON.stringify({ start, goal })}`);
  }
});
