import test from 'node:test';
import assert from 'node:assert/strict';
import { circleBlocked } from '../src/core.js';
import { TRAVERSAL, createTraversal, findVault, beginTraversal, advanceTraversal, moveAirborne, landingHeight } from '../src/infantry-traversal.js';
import { makeTownLayout } from '../src/town-layout.js';

const ground = () => 0;
const wall = { minX: -2, maxX: 2, minZ: -1.4, maxZ: -.6, height: 1.2 };
const position = () => ({ x: 0, y: 0, z: 0 });

test('a low sandbag-height barrier has a swept, collision-free rise/cross/land trajectory at different frame rates', () => {
  for (const fps of [30, 60, 144]) {
    const p = position(), state = createTraversal(), plan = findVault(p, 0, [wall], ground);
    assert.ok(plan);
    assert.equal(beginTraversal(state, p, plan), true);
    let impact = null;
    for (let frame = 0; frame < fps * 2 && state.kind !== 'grounded'; frame++) {
      impact = advanceTraversal(state, p, 1 / fps, [wall], ground);
      assert.equal(circleBlocked(p.x, p.z, TRAVERSAL.radius, [wall], p.y, TRAVERSAL.bodyHeight), false);
    }
    assert.equal(state.kind, 'grounded');
    assert.deepEqual(p, plan.end);
    assert.ok(p.z < wall.minZ - TRAVERSAL.radius);
    assert.equal(impact, 2);
  }
});

test('vault refuses high or thick barriers, a blocked landing, unsafe drops, narrow corners and low ceilings', () => {
  for (const obstacles of [
    [{ ...wall, height: 2 }],
    [{ ...wall, minZ: -3 }],
    [wall, { minX: -2, maxX: 2, minZ: -2.4, maxZ: -1.5, height: 3 }],
    [wall, { minX: -2, maxX: 2, minZ: -3, maxZ: 1, minY: 2, height: 2.2 }],
    [wall, { minX: .2, maxX: 2, minZ: -1.5, maxZ: -.5, height: 3 }],
  ]) assert.equal(findVault(position(), 0, obstacles, ground), null);
  assert.equal(findVault(position(), 0, [wall], () => -2), null);
  assert.equal(findVault(position(), Math.PI, [wall], ground), null);
  assert.equal(findVault(position(), 0, [{ ...wall, door: true }], ground), null);
});

test('a newly blocked vault stops before the collision and falls to a real support instead of teleporting through', () => {
  const p = position(), state = createTraversal(), plan = findVault(p, 0, [wall], ground);
  beginTraversal(state, p, plan);
  advanceTraversal(state, p, .26, [wall], ground);
  const blocker = { minX: -2, maxX: 2, minZ: -1.4, maxZ: -.45, minY: 1.3, height: 3.5 };
  advanceTraversal(state, p, .25, [wall, blocker], ground);
  assert.equal(state.blocked, true);
  assert.ok(p.z > -.4);
  assert.equal(circleBlocked(p.x, p.z, .4, [wall, blocker], p.y), false);
  for (let i = 0; i < 180; i++) advanceTraversal(state, p, 1 / 120, [wall, blocker], ground);
  assert.equal(state.kind, 'grounded');
  assert.equal(p.y, 0);
});

test('jumping changes the owned body position, collides overhead and lands without ground-height snapping', () => {
  for (const fps of [30, 60, 144]) {
    const p = { x: 0, y: .45, z: 0 }, state = createTraversal();
    beginTraversal(state, p);
    let peak = p.y;
    for (let i = 0; i < fps; i++) {
      advanceTraversal(state, p, 1 / fps, [], () => .45); peak = Math.max(peak, p.y);
    }
    assert.ok(Math.abs(peak - (.45 + 25 / 30)) < .003);
    assert.equal(p.y, .45);
    assert.equal(state.kind, 'grounded');
  }
  const p = position(), state = createTraversal();
  const ceiling = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 2.05, height: 2.2 };
  beginTraversal(state, p);
  let peak = 0;
  for (let i = 0; i < 120; i++) { advanceTraversal(state, p, 1 / 120, [ceiling], ground); peak = Math.max(peak, p.y); }
  assert.ok(peak <= .301 && peak > .2);
  assert.equal(p.y, 0);
});

test('airborne horizontal movement still respects tall walls and can cross an actually cleared low barrier', () => {
  const p = { x: 0, y: 1.3, z: 0 };
  moveAirborne(p, 0, -2.5, .4, [wall]);
  assert.ok(p.z < -2.4);
  assert.equal(landingHeight({ x: 0, y: 1.3, z: -1 }, 1.3, [wall], ground), 1.2);
  const blocked = { x: 0, y: .2, z: 0 };
  moveAirborne(blocked, 0, -2.5, .4, [wall]);
  assert.ok(blocked.z >= -.201);
});

test('real map windows reject standing-body vaults when the lintel blocks the path', () => {
  const town = makeTownLayout();
  const obstacles = town.obstacles;
  const sill = town.pieces.find(piece => piece.wall && piece.h === .88 && piece.w > 1);
  assert.ok(sill);
  const p = { x: sill.x, y: 0, z: sill.z + .75 };
  assert.equal(findVault(p, 0, obstacles, ground), null);
});

test('traversal state is independently owned and zero time freezes actions', () => {
  const first = createTraversal(), second = createTraversal(), p = position();
  beginTraversal(first, p);
  const before = structuredClone(first);
  advanceTraversal(first, p, 0, [], ground);
  assert.deepEqual(first, before); assert.deepEqual(p, position());
  assert.equal(second.kind, 'grounded');
  assert.equal(beginTraversal(first, p), false);
  assert.throws(() => advanceTraversal(first, p, -1, [], ground), RangeError);
});
