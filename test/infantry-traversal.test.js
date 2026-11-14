import test from 'node:test';
import assert from 'node:assert/strict';
import { circleBlocked, moveGround } from '../src/core.js';
import { TRAVERSAL, FALL_DAMAGE, landingDamage, createTraversal, findVault, findSillClimb, beginTraversal, advanceTraversal, moveAirborne, moveSupported, landingHeight } from '../src/infantry-traversal.js';
import { makeTownLayout } from '../src/town-layout.js';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { createEngineerState, engineerConstructionReservations } from '../src/engineer.js';
import { advanceConstruction, selectConstructionBlueprint } from '../src/construction.js';

const ground = () => 0;
const wall = { minX: -2, maxX: 2, minZ: -1.4, maxZ: -.6, height: 1.2 };
const position = () => ({ x: 0, y: 0, z: 0 });

test('walking off an unobstructed edge allows up to two metres and falls naturally without a jump', () => {
  for (const height of [.66, 1, 1.99, 2, 2.01, 4]) {
    const p = { x: -.6, y: height, z: 0 };
    const ledge = { minX: -4, maxX: 0, minZ: -3, maxZ: 3, height, walkable: true };
    const heightAt = x => x <= 0 ? height : 0;
    const groundMove = point => assert.fail('an edge drop must use airborne movement, not snap to ground');
    moveSupported(p, 1.2, 0, .4, [ledge], heightAt, (point, dx) => {
      if (point.x + dx <= 0) point.x += dx;
      else groundMove(point);
    }, TRAVERSAL.bodyHeight, 2);
    if (height > 2) {
      assert.ok(p.x <= .4, 'high falls remain blocked until an explicit jump');
    } else {
      assert.ok(p.x > .4);
      assert.equal(p.y, height, 'horizontal movement must not teleport feet down');
      const state = createTraversal();
      beginTraversal(state, p); state.velocity = 0;
      for (let frame = 0; frame < 180 && state.kind !== 'grounded'; frame++)
        advanceTraversal(state, p, 1 / 60, [ledge], heightAt);
      assert.equal(p.y, 0);
      assert.equal(state.kind, 'grounded');
    }
  }
});

test('shared landing damage leaves normal jumps safe, injures medium falls and kills high falls at all frame rates', () => {
  for (const fps of [30, 60, 144]) for (const [height, damage] of [[1, 0], [3, 0], [5, 40], [8, 100], [12, 100]]) {
    const p = { x: 0, y: height, z: 0 }, state = createTraversal();
    beginTraversal(state, p);
    state.velocity = 0;
    let impact = null;
    for (let frame = 0; frame < fps * 5 && state.kind !== 'grounded'; frame++) {
      impact = advanceTraversal(state, p, 1 / fps, [], ground);
    }
    assert.equal(state.kind, 'grounded');
    assert.ok(Math.abs(landingDamage(impact) - damage) < .001, `${height}m at ${fps}fps`);
    assert.equal(advanceTraversal(state, p, 1 / fps, [], ground), null, 'one fall cannot apply damage twice');
  }
  assert.equal(landingDamage(TRAVERSAL.jumpSpeed), 0);
  assert.equal(FALL_DAMAGE.lethalDrop, 8);
  assert.throws(() => landingDamage(NaN), RangeError);
  assert.throws(() => landingDamage(-1), RangeError);
});

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

test('active friendly construction interrupts a vault without becoming a landing surface', () => {
  const builder = { id: 'builder', team: 'friendly', health: 100, heading: 0, engineer: createEngineerState() };
  const teammate = { id: 'teammate', team: 'friendly' };
  const state = createTraversal(), p = position(), plan = findVault(p, 0, [wall], ground);
  assert.ok(plan);
  beginTraversal(state, p, plan);
  selectConstructionBlueprint(builder.engineer.construction, builder.id);
  const input = { builderId: builder.id, position: { x: 0, y: 0, z: -6.4 },
    candidate: { x: 0, y: 0, z: -3.2 }, holding: true, allowed: true, buildSeconds: 20 };
  advanceConstruction(builder.engineer.construction, input, 1, () => null);
  const reservations = engineerConstructionReservations(teammate, [builder]);
  assert.equal(reservations.length, 1);
  for (let i = 0; i < 240 && state.kind !== 'grounded'; i++) {
    advanceTraversal(state, p, 1 / 120, [wall], ground, reservations);
    assert.equal(circleBlocked(p.x, p.z, TRAVERSAL.radius, reservations, p.y, TRAVERSAL.bodyHeight), false);
  }
  assert.equal(state.blocked, true);
  assert.equal(state.kind, 'grounded');
  assert.equal(p.y, landingHeight(p, p.y, [wall], ground));
  assert.ok(p.y < reservations[0].height, 'a reservation is not physical support');
  assert.equal(builder.engineer.construction.progress, 1);
});

test('construction reservations do not become false support for elevated movement', () => {
  const builder = { id: 'builder', team: 'friendly', health: 100, heading: 0, engineer: createEngineerState() };
  const teammate = { id: 'teammate', team: 'friendly' };
  selectConstructionBlueprint(builder.engineer.construction, builder.id);
  advanceConstruction(builder.engineer.construction, { builderId: builder.id,
    position: { x: 0, y: 0, z: 3.2 }, candidate: { x: 0, y: 0, z: 0 },
    holding: true, allowed: true, buildSeconds: 20 }, 1, () => null);
  const reservations = engineerConstructionReservations(teammate, [builder]);
  assert.equal(landingHeight({ x: 0, y: 4, z: 0 }, 4, reservations, ground), 0);

  const ledge = { minX: -4, maxX: -.5, minZ: -3, maxZ: 3, height: 4, walkable: true };
  const heightAt = x => x <= -.5 ? 4 : 0;
  const p = { x: -1, y: 4, z: 0 };
  moveSupported(p, 2, 0, .4, [ledge, ...reservations], heightAt,
    (feet, dx, dz) => { feet.x += dx; feet.z += dz; }, TRAVERSAL.bodyHeight, 2);
  assert.ok(p.x <= -.1 + 1e-8, 'a reservation must not disguise a drop exceeding the real limit');
  assert.equal(p.y, 4);

  const upper = { x: -1, y: 4, z: 0 };
  moveSupported(upper, 2, 0, .4, reservations, () => 4,
    (feet, dx, dz) => { feet.x += dx; feet.z += dz; }, TRAVERSAL.bodyHeight, 2);
  assert.ok(upper.x > .9, 'the reservation must not block a genuinely supported upper floor');
});

test('a supported soldier cannot walk off a ledge into a friendly construction reservation', () => {
  const reservation = { minX: 0, maxX: 3, minZ: -2, maxZ: 2, minY: 0, height: 2, nonSupporting: true };
  const ledge = { minX: -4, maxX: 0, minZ: -3, maxZ: 3, height: 4, walkable: true };
  const heightAt = x => x <= 0 ? 4 : 0;
  const move = (p, dx, dz) => { p.x += dx; p.z += dz; };
  const p = { x: -1, y: 4, z: 0 };
  moveSupported(p, 2, 0, .4, [ledge, reservation], heightAt, move);
  assert.ok(p.x <= .4 + 1e-8, 'movement stops while real support remains under the body');
  assert.equal(landingHeight(p, p.y, [ledge, reservation], heightAt), 4);

  const clear = { x: -1, y: 4, z: 2.8 };
  moveSupported(clear, 2, 0, .4, [ledge, reservation], heightAt, move);
  assert.ok(clear.x > .9, 'unreserved ledges remain traversable');

  const above = { x: -1, y: 4, z: 0 };
  moveSupported(above, 2, 0, .4, [reservation], () => 4, move);
  assert.ok(above.x > .9, 'a real upper floor remains traversable above the site');

  const unsupported = { x: -.6, y: 4, z: 0 };
  moveSupported(unsupported, 1, 0, .4, [reservation], ground, move);
  assert.ok(unsupported.x > .3, 'an already unsupported body must not acquire an invisible ledge');
});

test('a soldier already inside a reservation can leave but cannot re-enter or cross physical obstacles', () => {
  const reservation = { minX: -2, maxX: 2, minZ: -1, maxZ: 1, minY: 0, height: 2, nonSupporting: true };
  const obstacle = { minX: 3.5, maxX: 4, minZ: -1, maxZ: 1, minY: 0, height: 2 };
  for (const airborne of [false, true]) {
    const p = position();
    const move = dx => airborne ? moveAirborne(p, dx, 0, .4, [reservation, obstacle])
      : moveSupported(p, dx, 0, .4, [reservation, obstacle], ground, moveGround);
    move(4);
    assert.ok(p.x >= 2.4 - 1e-8, 'the occupant can move out');
    assert.ok(p.x <= 3.1 + 1e-8, 'physical walls remain blocking');
    move(-2);
    assert.ok(p.x >= 2.4 - 1e-8, 'the former occupant cannot move back in');
  }
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

test('warehouse breaches allow a supported climb onto the sill without crossing the exterior edge', () => {
  const world = makeSihangBattlefield(new THREE.Scene(),
    (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  const openings = world.landmarks.warehouse.breaches;
  for (const [id, y] of [['north-main-lower', 14.4], ['north-center-lower', 14.4], ['north-right-middle', 7.2]]) {
    const opening = openings.find(item => item.id === id);
    const p = { x: opening.x, y, z: -41.25 }, state = createTraversal();
    const plan = findSillClimb(p, 0, openings, world.obstacles, world.walkHeight);
    assert.ok(plan, id);
    assert.equal(plan.end.z, -42, 'the climb stops on the wall rather than vaulting outside');
    assert.ok(plan.end.y > y && plan.end.y <= y + TRAVERSAL.maxVaultHeight);
    assert.equal(landingHeight(plan.end, plan.end.y, world.obstacles, world.walkHeight), plan.end.y);
    beginTraversal(state, p, plan);
    while (state.kind !== 'grounded') {
      advanceTraversal(state, p, 1 / 60, world.obstacles, world.walkHeight);
      assert.equal(circleBlocked(p.x, p.z, TRAVERSAL.radius, world.obstacles, p.y, TRAVERSAL.bodyHeight), false);
    }
    assert.deepEqual(p, plan.end);
    assert.equal(findSillClimb(plan.start, Math.PI, openings, world.obstacles, world.walkHeight), null);
    const ceiling = { minX: opening.x - 2, maxX: opening.x + 2, minZ: -42.6, maxZ: -41.5,
      minY: y + 1.8, height: y + 3 };
    assert.equal(findSillClimb(plan.start, 0, openings, [...world.obstacles, ceiling], world.walkHeight), null);
  }
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
