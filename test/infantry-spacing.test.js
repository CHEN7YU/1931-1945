import test from 'node:test';
import assert from 'node:assert/strict';
import { infantrySteering, advanceInfantryPath } from '../src/infantry-spacing.js';
import { createTactics, objectiveDestination, objectiveAdvanceRequired } from '../src/tactics.js';
import { advanceAITurn } from '../src/ai-turning.js';
import { circleBlocked, createNavigator, moveGround, segmentClear } from '../src/core.js';

const person = (id, x, z, heading = 0) => ({ id: `person-${id}`, health: 100, position: { x, y: 0, z }, heading, tactics: { id } });
test('short authored stair nodes do not inspect terrain beyond their actual destination', () => {
  const actor = person(1, 0, 0);
  const blocked = point => point.z < -.3;
  const options = { spacing: 1.2, constrained: true, blocked, lookAhead: .2 };
  const result = infantrySteering(actor, [], { x: 0, z: -.2 }, options);
  assert.deepEqual(result, { x: 0, z: -1, speed: 1, waitingFor: null });
  assert.throws(() => infantrySteering(actor, [], { x: 0, z: -.2 }, { ...options, lookAhead: 0 }), RangeError);
});

test('a bounded authored arrival radius still cannot skip a different floor or unseen route node', () => {
  const position = { x: 0, y: 4.2, z: -15 };
  const path = [{ x: .15, y: 4.2, z: -15 }, { x: 0, y: 0, z: -37 }];
  assert.equal(advanceInfantryPath(position, path, () => false, .2), path[0]);
  assert.deepEqual(path, [{ x: 0, y: 0, z: -37 }]);
  assert.throws(() => advanceInfantryPath(position, path, () => false, NaN), RangeError);
});

test('open-ground soldiers keep a consistent passing side instead of running into a shared stopping point', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1.6);
  const result = infantrySteering(actor, [actor, other], { x: 0, z: -1 }, { spacing: 2.2, constrained: false, blocked: () => false });
  assert.ok(result.x > 0 && result.z < 0 && result.speed < 1);
  assert.ok(Math.atan2(result.x, -result.z) < Math.PI / 6, 'bounded steering does not snap soldiers sideways');
});

test('irrelevant neighbors behind a clear route do not trigger swept terrain queries', () => {
  const actor = person(100, 0, 0);
  const neighbors = Array.from({ length: 20 }, (_, i) => person(i, (i % 5 - 2) * .2, 2.5 + Math.floor(i / 5) * .15));
  let queries = 0;
  const result = infantrySteering(actor, neighbors, { x: 0, z: -1 }, {
    spacing: 2.2, constrained: false, blocked: () => { queries++; return false; },
  });
  assert.deepEqual(result, { x: 0, z: -1, speed: 1, waitingFor: null });
  assert.equal(queries, 5, 'only the unchanged five samples along the actual 0.65m route are needed');
});

test('reservations across a wall remain irrelevant and terrain connections are not cached across calls', () => {
  const other = person(1, .8, -.3);
  const reservations = new Map([[other.id, { x: 0, z: -.65 }]]);
  const run = wall => infantrySteering(person(2, 0, 0), [other], { x: 0, z: -1 }, {
    spacing: 2.2, constrained: false, reservations,
    blocked: point => wall && point.x > .3 && point.x < .5,
  });
  assert.equal(run(true).speed, 1, 'a reservation through a wall cannot block the lane');
  const open = run(false);
  assert.ok(open.x !== 0 || open.speed !== 1, 'opening the passage restores peer avoidance immediately');
  assert.equal(run(true).speed, 1, 'closing the passage cannot reuse an old connection');
});

test('lazy peer connections preserve eager terrain filtering across seeded crowd, floor and reservation cases', () => {
  let seed = 1938;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let index = 0; index < 500; index++) {
    const actor = person(100, 0, 0), direction = { x: random() * 2 - 1, z: random() * 2 - 1 };
    if (index % 2) actor.tactics.traffic = { waitSeconds: random() * 3, side: index % 3 ? 1 : -1,
      yieldPoint: { x: random() * 2 - 1, z: random() * 2 - 1 }, blockerId: 'person-1', until: 11,
      progress: { x: .1, z: .1 }, direction: { x: .1, z: -1 }, reason: null };
    const neighbors = Array.from({ length: 20 }, (_, i) => ({
      ...person(i + 1, random() * 6 - 3, random() * 6 - 3, random() * 7),
      health: i % 9 ? 100 : 0, vehicleId: i % 11 ? null : 'tank',
      locomotion: { speed: random() * 4 }, velocity: { x: random() * 6 - 3, z: random() * 6 - 3 },
      intent: { x: random() * 2 - 1, z: random() * 2 - 1 },
    }));
    neighbors[0].position.y = 3.2;
    const walls = Array.from({ length: 4 }, () => {
      const x = random() * 6 - 3, z = random() * 6 - 3;
      return { minX: x, maxX: x + .12, minZ: z, maxZ: z + 1.5, height: 4 };
    });
    const blocked = point => circleBlocked(point.x, point.z, .43, walls);
    const eager = neighbors.filter(other => {
      const length = Math.hypot(other.position.x, other.position.z);
      if (other.health <= 0 || other.vehicleId || Math.abs(other.position.y) >= 1.5 || length >= 3.2) return false;
      const steps = Math.max(1, Math.ceil(length / .16));
      for (let step = 1; step <= steps; step++) {
        if (blocked({ x: other.position.x * step / steps, z: other.position.z * step / steps })) return false;
      }
      return true;
    });
    const reservations = new Map(neighbors.filter((_, i) => i % 3 === 0)
      .map(other => [other.id, { x: random() * 3 - 1.5, z: random() * 3 - 1.5 }]));
    const original = structuredClone(actor), expectedReservations = structuredClone(reservations);
    const options = { spacing: index % 2 ? 2.2 : 1.45, constrained: index % 3 === 0,
      dt: 1 / [30, 60, 144][index % 3], now: 10, blocked };
    const expected = infantrySteering(original, eager, direction, { ...options, reservations: expectedReservations });
    const actual = infantrySteering(actor, neighbors, direction, { ...options, reservations });
    assert.deepEqual(actual, expected, `steering case ${index}`);
    assert.deepEqual(actor, original, `traffic case ${index}`);
    assert.deepEqual(reservations, expectedReservations, `reservation case ${index}`);
  }
});
test('a narrow bottleneck waits or yields backward, rather than trying to pass through a wall or another body', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1.2, Math.PI);
  const options = { spacing: 2.2, constrained: true, blocked: () => false };
  const yieldStep = infantrySteering(actor, [other], { x: 0, z: -1 }, options);
  assert.ok(yieldStep.speed > 0 && yieldStep.z >= -1e-8, 'a loser may yield sideways or backwards, never through the oncoming body');
  other.position.z = -.8;
  assert.equal(infantrySteering(actor, [other], { x: 0, z: -1 }, { ...options, blocked: () => true }).speed, 0);
  other.health = 0;
  assert.equal(infantrySteering(actor, [other], { x: 0, z: -1 }, options).speed, 1);
});

test('right-side obstruction does not prevent passing on a swept-clear left side', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1.6);
  const result = infantrySteering(actor, [other], { x: 0, z: -1 }, {
    spacing: 2.2, constrained: false, blocked: point => point.x > .1,
  });
  assert.ok(result.x < 0 && result.z < 0 && result.speed > 0);
});

test('a detour rejoins the visible path instead of turning back to an obsolete shared corner, without cutting walls or floors', () => {
  const position = { x: 1, y: 0, z: 1 }, path = [{ x: 0, z: 1 }, { x: 1, z: -2 }];
  assert.deepEqual(advanceInfantryPath(position, path, () => true), { x: 1, z: -2 });
  const wallPath = [{ x: 0, z: 1 }, { x: 1, z: -2 }];
  assert.deepEqual(advanceInfantryPath(position, wallPath, () => false), { x: 0, z: 1 });
  const stairs = [{ x: 0, y: 0, z: 1 }, { x: 1, y: 3.2, z: 1 }];
  assert.deepEqual(advanceInfantryPath(position, stairs, () => true), stairs[0]);
});

test('swept checks reject a clear endpoint behind a thin wall and ignore neighbours across walls or floors', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1);
  const result = infantrySteering(actor, [other], { x: 0, z: -1 }, {
    spacing: 2.2, constrained: false, blocked: point => point.x > .15 && point.x < .35,
  });
  assert.ok(result.x < 0, 'cannot skip over the wall when choosing a passing side');
  other.position.y = 3.2;
  assert.equal(infantrySteering(actor, [other], { x: 0, z: -1 }, {
    spacing: 2.2, constrained: false, blocked: () => false,
  }).speed, 1);
  other.position.y = 0; other.position.x = .8; other.position.z = -.3;
  assert.equal(infantrySteering(actor, [other], { x: 0, z: -1 }, {
    spacing: 2.2, constrained: false, blocked: point => point.x > .3 && point.x < .5,
  }).speed, 1);
});

test('blocked traffic accumulates simulation-time waiting and recovers when space opens', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1.2, Math.PI);
  for (let frame = 0; frame < 120; frame++) {
    const result = infantrySteering(actor, [other], { x: 0, z: -1 }, {
      spacing: 2.2, constrained: true, blocked: () => true, dt: 1 / 60, now: frame / 60,
    });
    assert.equal(result.speed, 0);
  }
  assert.ok(actor.tactics.traffic.waitSeconds > 1.99);
  assert.equal(actor.tactics.traffic.reason, 'no-yield-space');
  assert.ok(infantrySteering(actor, [other], { x: 0, z: -1 }, {
    spacing: 2.2, constrained: true, blocked: () => false, dt: 1 / 60, now: 2,
  }).speed > 0);
});

test('head-on pairs and three-way crossing traffic make real progress instead of mutual permanent waiting', () => {
  for (const count of [2, 3]) {
    const actors = Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count;
      const actor = person(index + 1, Math.cos(angle) * 2, Math.sin(angle) * 2);
      actor.goal = { x: -Math.cos(angle) * 4, z: -Math.sin(angle) * 4 };
      actor.heading = Math.atan2(actor.position.x - actor.goal.x, actor.position.z - actor.goal.z);
      actor.locomotion = { speed: 0 };
      return actor;
    });
    const dt = 1 / 60;
    for (let frame = 0; frame < 60 * 20; frame++) {
      const reservations = new Map(), snapshots = actors.map(actor => ({ ...actor, position: { ...actor.position },
        locomotion: { ...actor.locomotion } }));
      for (const actor of actors) {
        const dx = actor.goal.x - actor.position.x, dz = actor.goal.z - actor.position.z;
        const length = Math.hypot(dx, dz);
        if (length < .2) { actor.locomotion.speed = 0; continue; }
        const steering = infantrySteering(actor, snapshots, { x: dx, z: dz }, {
          spacing: 2.2, constrained: false, dt, now: frame * dt, reservations, blocked: () => false,
        });
        const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), dt, true);
        actor.locomotion.speed = turn.mayMove ? 2 * steering.speed : 0;
        const step = Math.min(length, actor.locomotion.speed * dt);
        actor.position.x += steering.x * step; actor.position.z += steering.z * step;
      }
    }
    assert.ok(actors.every(actor => Math.hypot(actor.position.x - actor.goal.x, actor.position.z - actor.goal.z) < .25));
  }
});

test('five and seven soldiers physically clear a shared building corner without shrinking bodies or skipping turns', () => {
  const obstacles = [{ minX: -10, maxX: 0, minZ: -10, maxZ: 0 }], navigate = createNavigator(obstacles);
  for (const count of [5, 7]) for (const hz of [30, 60, 144]) {
    const actors = Array.from({ length: count }, (_, index) => {
      const actor = person(index + 1, -3.4 + index % 3 * 1.4, 1.4 + Math.floor(index / 3) * 1.4);
      actor.goal = { x: 1.5 + index * 1.2, z: -4 };
      actor.path = navigate(actor.position, actor.goal); actor.locomotion = { speed: 0 };
      return actor;
    });
    const dt = 1 / hz;
    let firstPass = null;
    for (let frame = 0; frame < hz * 20; frame++) {
      const now = frame * dt, reservations = new Map();
      const snapshots = actors.map(actor => ({ ...actor, position: { ...actor.position },
        locomotion: { ...actor.locomotion }, intent: actor.path.length ? {
          x: actor.path[0].x - actor.position.x, z: actor.path[0].z - actor.position.z,
        } : null }));
      for (const actor of actors) {
        advanceInfantryPath(actor.position, actor.path, point => segmentClear(actor.position, point, .46, obstacles));
        if (!actor.path.length) { actor.locomotion.speed = 0; continue; }
        const waypoint = actor.path[0], dx = waypoint.x - actor.position.x, dz = waypoint.z - actor.position.z;
        const steering = infantrySteering(actor, snapshots, { x: dx, z: dz }, {
          spacing: 2.2, constrained: true, dt, now, reservations,
          blocked: point => circleBlocked(point.x, point.z, .43, obstacles),
        });
        const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), dt, true);
        const before = { ...actor.position };
        if (turn.mayMove) {
          const step = Math.min(1.9 * steering.speed * dt, Math.hypot(dx, dz));
          moveGround(actor.position, steering.x * step, steering.z * step, .42, obstacles);
        }
        actor.locomotion.speed = Math.hypot(actor.position.x - before.x, actor.position.z - before.z) / dt;
        assert.equal(circleBlocked(actor.position.x, actor.position.z, .419, obstacles), false);
      }
      for (let first = 0; first < actors.length; first++) for (let second = first + 1; second < actors.length; second++) {
        assert.ok(Math.hypot(actors[first].position.x - actors[second].position.x,
          actors[first].position.z - actors[second].position.z) >= .84, 'physical capsules cannot pass through one another');
      }
      if (firstPass === null && actors.some(actor => actor.position.z < -1)) firstPass = now;
      if (actors.every(actor => actor.position.z < -1)) break;
    }
    assert.ok(firstPass !== null && firstPass <= 5, `${count} soldiers at ${hz} Hz begin clearing within five seconds`);
    assert.ok(actors.every(actor => actor.position.z < -1), `${count} soldiers at ${hz} Hz all clear within twenty seconds: ${JSON.stringify(actors.map(actor => actor.position))}`);
  }
});
test('all eleven members and all ten real friendly squad identifiers have distinct stable capture destinations', () => {
  const goal = { x: 0, z: 0, radius: 13 }, points = [];
  for (let squad = 100; squad < 110; squad++) for (let slot = 0; slot < 11; slot++) {
    const state = createTactics(slot, squad, slot), point = objectiveDestination(state, { x: 0, z: 70 }, goal);
    assert.ok(Math.hypot(point.x, point.z) < 12);
    for (const other of points) assert.ok(Math.hypot(point.x - other.x, point.z - other.z) > 1.5);
    points.push(point);
  }
});

test('a soldier already at its spread-out capture slot can fire instead of endlessly trying to advance toward the center', () => {
  const objective = { id: 'A', x: 0, z: 0, radius: 13 }, tactics = createTactics(1, 109, 10);
  const goal = objectiveDestination(tactics, { x: 0, z: 70 }, objective);
  assert.ok(Math.hypot(goal.x, goal.z) > objective.radius * .7);
  const actor = { friendly: true, playerUnit: false, position: goal, tactics };
  assert.equal(objectiveAdvanceRequired(actor, objective, 55), false);
  tactics.personalSlot = { objectiveId: 'A', point: { x: goal.x + 1, z: goal.z } };
  actor.position = { ...tactics.personalSlot.point };
  assert.equal(objectiveAdvanceRequired(actor, objective, 55), false);
});
