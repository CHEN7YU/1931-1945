import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { NANJING_CASEMATE as C, subtractCasemateBox } from '../src/nanjing-casemate.js';
import { createNavigator } from '../src/core.js';
import { NANJING_EMPLACEMENTS, createEmplacement, aimEmplacement, emplacementPose, emplacementObstacles } from '../src/emplacements.js';
import { NANJING_GATE_HEIGHT, NANJING_GATE_POSITIONS, NANJING_FLANKING_BUFFERS } from '../src/nanjing-layout.js';
import { moveSupported, TRAVERSAL } from '../src/infantry-traversal.js';
let world;
before(() => {
  world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  world.setGroundNavigation(createNavigator(world.doorSystem.navigationObstacles));
});

test('the protected room fits within the west masonry below the wall top', () => {
  const west = NANJING_FLANKING_BUFFERS.find(buffer => buffer.side === -1);
  assert.ok(C.room.minX > west.minX && C.room.maxX < west.maxX);
  assert.ok(C.ceilingY < NANJING_GATE_HEIGHT);
  assert.equal(C.stairs.steps, 18);
  const pieces = subtractCasemateBox({ minX: -23.7, maxX: -1.6, minY: 0, maxY: 8.58, minZ: 15.2, maxZ: 21.2 });
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(box => !(box.minX < -16.5 && box.maxX > -16.5 &&
    box.minY < 4.4 && box.maxY > 4.4 && box.minZ < 18 && box.maxZ > 18)));
});

const gun = () => createEmplacement(NANJING_EMPLACEMENTS.find(point => point.id === 'gate-wall-mg'));
function walk(path, position) {
  for (const point of path) {
    moveSupported(position, point.x - position.x, point.z - position.z, .42,
      world.obstacles, world.walkHeight, world.moveInfantry, TRAVERSAL.bodyHeight, 2);
    assert.ok(Math.hypot(position.x - point.x, position.z - point.z) < .026, JSON.stringify({ position, point }));
    assert.ok(Math.abs(position.y - point.y) < .026, JSON.stringify({ position, point }));
  }
}

test('actual infantry movement reaches the room from the core and returns without teleporting', () => {
  const start = new THREE.Vector3(-6.2, 0, 0), goal = emplacementPose(gun(), C.floorY).operator;
  const path = world.elevatedPath(start, goal);
  assert.ok(path.length > 25, 'the route contains real stair and corridor connectors');
  walk(path, start);
  assert.ok(world.casemateContains(start));
  const out = world.elevatedPath(start, { x: -6.2, y: 0, z: 0 });
  assert.ok(out.length > 25);
  walk(out, start);
  assert.ok(start.distanceTo(new THREE.Vector3(-6.2, 0, 0)) < .026);
});

test('the fixed virtual muzzle retains the bridge view without cutting a C-shaped notch in the side curtain', () => {
  for (const z of [38, 52, 65]) for (const x of [-28, -24, -20]) {
    const point = gun(), target = new THREE.Vector3(x, 1.5, z);
    aimEmplacement(point, target, 10, C.floorY);
    const p = emplacementPose(point, C.floorY).muzzle, start = new THREE.Vector3(p.x, p.y, p.z);
    const direction = target.clone().sub(start), distance = direction.length();
    const ray = new THREE.Raycaster(start, direction.normalize(), 0, distance - .1);
    const hits = ray.intersectObjects(world.solids, true);
    const walls = hits.filter(hit => !String(hit.object.userData.nanjingFeature).startsWith('bridge-'));
    if (x === -28 && z === 38)
      assert.ok(walls.some(hit => hit.object.userData.nanjingFeature === 'barbican-curtain-wall'),
        'the close extreme-left angle is blocked by the restored side wall, not an open notch');
    else assert.equal(walls.length, 0, `firing room blocks the bridge at ${x},${z}: ${walls[0]?.object.userData.nanjingFeature}`);
    if (x === -24) assert.equal(hits.length, 0, 'the original bridge-centre sight lines stay clear');
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(-14, 4.45, 19.7), new THREE.Vector3(0, 0, 1), 0, 10);
  assert.ok(ray.intersectObjects(world.solids, true).length > 0, 'only the firing slit is open');
  for (const y of [1, 3.2, 4, 5, 6, 8]) {
    const side = new THREE.Raycaster(new THREE.Vector3(-21.5, y, 28), new THREE.Vector3(0, 0, -1), 0, 8);
    const hit = side.intersectObjects(world.solids, true).find(hit => hit.object.userData.nanjingFeature === 'barbican-curtain-wall');
    assert.ok(hit, `the side curtain must have a continuous south face at height ${y}`);
    assert.ok(Math.abs(hit.point.z - 25.6) < .001);
  }
});

test('all permitted gun headings retain a clear operator position and a crouched exit', () => {
  const point = gun(), own = emplacementObstacles(point);
  for (let index = 0; index <= 20; index++) {
    point.yaw = point.heading - point.weapon.settings.traverse + index * point.weapon.settings.traverse / 10;
    const operator = emplacementPose(point, C.floorY).operator;
    for (const height of [.65, 1.2, 1.75]) {
      const position = new THREE.Vector3(operator.x, operator.y, operator.z);
      moveSupported(position, Math.sin(point.yaw) * .3, Math.cos(point.yaw) * .3, .43,
        world.obstacles, world.walkHeight, world.moveInfantry, height, 2);
      assert.ok(Math.hypot(position.x - operator.x, position.z - operator.z) > .25, 'rotated operator can back away');
    }
  }
  assert.equal(world.solids.some(mesh => mesh.userData.nanjingFeature === 'casemate-sign'), false);
  assert.equal(own.some(obstacle => obstacle.circular), true, 'the tripod uses its actual narrow central support');
});

test('room routing also descends the existing wall ramps from the gate crown', () => {
  const goal = emplacementPose(gun(), C.floorY).operator;
  const path = world.elevatedPath({ x: 0, y: NANJING_GATE_HEIGHT, z: NANJING_GATE_POSITIONS[1] }, goal);
  assert.ok(path.length > 0);
  assert.ok(path.some(point => point.y === 0));
  assert.ok(path.some(point => point.y > 0 && point.y < C.floorY));
  assert.ok(Math.abs(path.at(-1).y - C.floorY) < .025);
});
