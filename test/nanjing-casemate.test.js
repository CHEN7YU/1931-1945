import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { NANJING_CASEMATE as C, subtractCasemateBox } from '../src/nanjing-casemate.js';
import { createNavigator } from '../src/core.js';
import { NANJING_EMPLACEMENTS, createEmplacement, aimEmplacement, emplacementPose } from '../src/emplacements.js';
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

test('the fixed virtual muzzle has a clear slit view toward the bridge, while adjacent masonry remains solid', () => {
  for (const z of [38, 52, 65]) {
    const point = gun(), target = new THREE.Vector3(-24, 1.5, z);
    aimEmplacement(point, target, 10, C.floorY);
    const p = emplacementPose(point, C.floorY).muzzle, start = new THREE.Vector3(p.x, p.y, p.z);
    const direction = target.clone().sub(start), distance = direction.length();
    const ray = new THREE.Raycaster(start, direction.normalize(), 0, distance - .1);
    const hits = ray.intersectObjects(world.solids, true);
    assert.equal(hits.length, 0, `bridge sight line blocked at z=${z}: ${hits[0]?.object.userData.nanjingFeature}`);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(-14, 4.45, 19.7), new THREE.Vector3(0, 0, 1), 0, 10);
  assert.ok(ray.intersectObjects(world.solids, true).length > 0, 'only the firing slit is open');
});

test('room routing also descends the existing wall ramps from the gate crown', () => {
  const goal = emplacementPose(gun(), C.floorY).operator;
  const path = world.elevatedPath({ x: 0, y: NANJING_GATE_HEIGHT, z: NANJING_GATE_POSITIONS[1] }, goal);
  assert.ok(path.length > 0);
  assert.ok(path.some(point => point.y === 0));
  assert.ok(path.some(point => point.y > 0 && point.y < C.floorY));
  assert.ok(Math.abs(path.at(-1).y - C.floorY) < .025);
});
