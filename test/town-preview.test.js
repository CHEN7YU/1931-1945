import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTownLayout } from '../src/town-layout.js';
import { createWalkSupport, TOWN_STOREYS } from '../src/multistory.js';
import { BRIDGE, groundHeight, bridgeGroundHeight } from '../src/ground.js';
import { OBJECTIVES, circleBlocked, segmentClear, createNavigator } from '../src/core.js';
import { PREVIEW_OBJECTIVES, PREVIEW_BASES, PREVIEW_BRIDGE, PREVIEW_BOUNDS, makeTownPreviewLayout } from '../src/town-preview-layout.js';
import { makeOutskirtsLayout } from '../src/outskirts-layout.js';

test('A tower seals only the interior left doorway and retains the street entrance and staircase access', () => {
  const town = makeTownPreviewLayout(), id = 'canal-south-granary';
  const tower = town.buildings.find(building => building.id === id);
  assert.equal(town.passages.some(passage => passage.id === `${id}-partition-door`), false);
  assert.equal(town.pieces.some(piece => piece.id.startsWith(`${id}-partition-frame-`)), false);
  assert.ok(town.passages.some(passage => passage.id === `${id}-east-door`));
  assert.equal(circleBlocked(tower.x,tower.z-.9,.2,town.obstacles,0),true);
  const door = town.passages.find(passage => passage.id === `${id}-east-door`);
  assert.equal(circleBlocked(door.x,door.z,.2,town.obstacles,0),false);
  const navigate = createNavigator(town.obstacles,.5,.42);
  assert.ok(navigate({x:door.x-.7,z:door.z},tower.stairs[0].lower).length,
    'the retained entrance must still reach the stairs around the end of the partition');
  assert.ok(makeTownLayout().passages.some(passage=>passage.id===`${id}-partition-door`),
    'the hidden legacy street layout is unchanged');
});

test('empty map proposal has three separated triangular landmarks within a compact crop', () => {
  const [a, b, c] = PREVIEW_OBJECTIVES;
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
  assert.ok(area > 800);
  for (const point of PREVIEW_OBJECTIVES) {
    assert.ok(point.x - point.radius > PREVIEW_BOUNDS.minX && point.x + point.radius < PREVIEW_BOUNDS.maxX);
    assert.ok(point.z - point.radius > PREVIEW_BOUNDS.minZ && point.z + point.radius < PREVIEW_BOUNDS.maxZ);
    for (const other of PREVIEW_OBJECTIVES.filter(other => other !== point)) {
      assert.ok(Math.hypot(point.x - other.x, point.z - other.z) > 40);
    }
  }
  assert.ok(PREVIEW_BOUNDS.maxX - PREVIEW_BOUNDS.minX <= 144);
  assert.ok(PREVIEW_BOUNDS.maxZ - PREVIEW_BOUNDS.minZ <= 138);
});

test('preview layout changes neither the default battle layout nor its bridge and objectives', () => {
  const before = makeTownLayout(), objectives = structuredClone(OBJECTIVES);
  const town = makeTownPreviewLayout();
  assert.deepEqual(makeTownPreviewLayout(), town);
  assert.deepEqual(makeTownLayout(), before);
  assert.deepEqual(OBJECTIVES, objectives);
  assert.equal(BRIDGE.height, .45);
  assert.equal(TOWN_STOREYS['canal-south-depot'], 4);
  assert.equal(town.buildings.find(building => building.id === 'canal-south-granary').storeys, 4);
  assert.equal(town.buildings.some(building => building.id === 'canal-south-depot'), false, 'the gate forecourt is open');
  assert.equal(town.fortifications.sides, 2);
  const tower = town.buildings.find(building => building.id === 'canal-south-granary');
  for (const flight of tower.stairs) {
    assert.ok(flight.lower.z > tower.z - tower.d / 2 && flight.lower.z < tower.z + tower.d / 2);
    assert.deepEqual(flight.lower, flight.path[0]);
    assert.deepEqual(flight.upper, flight.path.at(-1));
  }
});

test('gate arch has a real infantry and vehicle passage, side breach and matching high collision', () => {
  const town = makeTownPreviewLayout(), walls = town.obstacles.filter(piece => piece.id.startsWith('fort-'));
  assert.equal(segmentClear({ x: 50, z: 3 }, { x: 64, z: 3 }, 2.2, walls), true);
  assert.equal(segmentClear({ x: 50, z: 31 }, { x: 64, z: 31 }, 1.2, walls), true);
  assert.equal(circleBlocked(56, 20, .4, walls), true);
  assert.equal(circleBlocked(56, 3, .4, walls, 5), true);
  assert.equal(circleBlocked(56, 3, .4, walls), false);
  for (const point of PREVIEW_OBJECTIVES) {
    assert.equal(circleBlocked(point.view.x, point.view.z, .34, town.obstacles), false, point.id);
  }
});

test('east-gate forecourt separates the closed side building from the gatehouse without moving C', () => {
  const town = makeTownPreviewLayout(), gate = town.fortifications.gate;
  const defaults = makeOutskirtsLayout(), fortress = makeOutskirtsLayout({ eastGate: gate });
  assert.ok(defaults.sideBuildings.some(building => building.x === 65 && building.z === 12));
  assert.equal(fortress.sideBuildings.some(building => building.x === 65 && building.z === 12), false);
  const shifted = fortress.sideBuildings.find(building => building.x === 68 && building.z === 22);
  assert.ok(shifted);
  const obstacles = fortress.sideBuildings.map(building => ({
    minX: building.x - building.w / 2 - .8, maxX: building.x + building.w / 2 + .8,
    minZ: building.z - building.d / 2 - .9, maxZ: building.z + building.d / 2 + .9,
    height: 12,
  }));
  assert.ok(segmentClear({ x: 48, z: 3 }, { x: 68, z: 3 }, 2.2, [...town.obstacles, ...obstacles]),
    'the real gate route remains clear for infantry and armor, including roof overhangs');
  assert.deepEqual(PREVIEW_OBJECTIVES.find(point => point.id === 'C').view, { x: 44, z: 3, yaw: -Math.PI / 2, pitch: .1 });
  for (const side of [-1, 1]) {
    const tower = { minX: gate.x - 2.1, maxX: gate.x + 2.1,
      minZ: gate.z + side * 6 - 2.55, maxZ: gate.z + side * 6 + 2.55 };
    const house = obstacles.find(obstacle => obstacle.minZ > 10 && obstacle.minX > gate.x);
    assert.ok(house.minZ > tower.maxZ + 2 || house.minX > tower.maxX + 2);
  }
});

test('raised preview bridge remains walkable with unchanged default support', () => {
  const town = makeTownPreviewLayout();
  const height = (x, z) => bridgeGroundHeight(x, z, PREVIEW_BRIDGE);
  const support = createWalkSupport(town.pieces, height), position = { x: 8, y: 0, z: -5 };
  for (let i = 0; i < 450; i++) support.move(position, 0, -.05, .34, town.obstacles);
  assert.ok(position.z < -27);
  assert.equal(position.y, height(position.x, position.z));
  assert.equal(height(8, -16), .95);
  assert.equal(groundHeight(8, -16), .45);
});

test('relocated preview tower retains all three physical stair flights', () => {
  const town = makeTownPreviewLayout(), tower = town.buildings.find(building => building.id === 'canal-south-granary');
  const support = createWalkSupport(town.pieces, (x, z) => bridgeGroundHeight(x, z, PREVIEW_BRIDGE));
  const position = { ...tower.stairs[0].lower };
  for (const flight of tower.stairs) {
    for (const target of flight.path) {
      const dx = target.x - position.x, dz = target.z - position.z;
      const steps = Math.ceil(Math.hypot(dx, dz) / .025);
      for (let i = 0; i < steps; i++) support.move(position, dx / steps, dz / steps, .34, town.obstacles);
      assert.ok(Math.hypot(position.x - target.x, position.z - target.z) < .05);
    }
    assert.ok(Math.abs(position.y - flight.upper.y) < .001);
  }
  assert.ok(Math.abs(position.y - 9.6) < .001);
});

test('both proposed bases can reach every capture circle without leaving the crop', () => {
  const town = makeTownPreviewLayout(), navigate = createNavigator(town.obstacles, 1, .46);
  for (const base of PREVIEW_BASES) {
    assert.equal(circleBlocked(base.x, base.z, 1, town.obstacles), false);
    for (const objective of PREVIEW_OBJECTIVES) {
      const path = navigate(base, objective);
      assert.ok(path.length, `${base.id} to ${objective.id}`);
      for (const point of path) {
        assert.ok(point.x >= PREVIEW_BOUNDS.minX && point.x <= PREVIEW_BOUNDS.maxX);
        assert.ok(point.z >= PREVIEW_BOUNDS.minZ && point.z <= PREVIEW_BOUNDS.maxZ);
      }
    }
  }
});
