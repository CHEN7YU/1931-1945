import test from 'node:test';
import assert from 'node:assert/strict';
import { infantrySteering, advanceInfantryPath, sampledRouteClear } from '../src/infantry-spacing.js';
import { createTactics, objectiveDestination, objectiveAdvanceRequired } from '../src/tactics.js';
import { advanceAITurn } from '../src/ai-turning.js';
import { circleBlocked, createNavigator, moveGround, segmentClear } from '../src/core.js';
import { SIHANG_ASSEMBLY_ARRIVAL, sihangRetreatBlockedWaypoint, sihangRetreatYieldPosition } from '../src/sihang-formation.js';

const person = (id, x, z, heading = 0) => ({ id: `person-${id}`, health: 100, position: { x, y: 0, z }, heading, tactics: { id } });
test('compact assembly spacing permits a soldier to enter a 75 cm rank without changing normal traffic', () => {
  const peers = [person(2, 0, -.75), person(3, 0, .75)];
  const options = { spacing: .7, minimumSeparation: .7, constrained: true, blocked: () => false, lookAhead: .65 };
  const result = infantrySteering(person(1, .8, 0), peers, { x: -1, z: 0 }, options);
  assert.equal(result.speed, 1);
  assert.equal(result.x, -1);
  const nearbyRank = [person(4, 0, -.735), person(5, 0, .735)];
  const aligned = infantrySteering(person(6, .8, 0), nearbyRank, { x: -1, z: 0 }, options);
  assert.equal(aligned.speed, 1, 'collision-clear rank neighbors must not be treated as a leader ahead');
  assert.equal(aligned.x, -1);
  assert.throws(() => infantrySteering(person(1, .8, 0), peers, { x: -1, z: 0 },
    { ...options, minimumSeparation: .9 }), RangeError);
});

test('a late assembly member finishes its aisle turn instead of orbiting between settled ranks', () => {
  const arrival = SIHANG_ASSEMBLY_ARRIVAL;
  const actor = person(167, 12.5555298324, -2.6654652221, 1.109985);
  const guards = [person(289, 11.8 + arrival * .13, -1.7 - arrival * .97),
    person(300, 11.8 - arrival * .3, -4.1 + arrival * .91),
    person(290, 14.2 + arrival * .12, -1.7 - arrival * .72),
    person(301, 14.2 + arrival * .09, -4.1 + arrival * .965)];
  const path = [{ x: 12.6, y: 0, z: -2.9 }, { x: 5.8, y: 0, z: -2.9 }];
  for (let step = 0; step < 1000 && path.length; step++) {
    while (path.length && Math.hypot(actor.position.x - path[0].x, actor.position.z - path[0].z) < arrival)
      path.shift();
    const goal = path[0];
    if (!goal) break;
    const dx = goal.x - actor.position.x, dz = goal.z - actor.position.z;
    const steering = infantrySteering(actor, guards, { x: dx, z: dz }, {
      spacing: 1.02, constrained: true, dt: .05, now: step * .05,
      lookAhead: Math.min(.65, Math.hypot(dx, dz)), blocked: () => false,
    });
    const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), .05, true);
    if (!turn.mayMove) continue;
    const length = Math.min(Math.hypot(dx, dz), 2.7 * .05 * steering.speed * turn.moveScale);
    const position = { x: actor.position.x + turn.direction.x * length,
      z: actor.position.z + turn.direction.z * length };
    if (guards.every(guard => Math.hypot(position.x - guard.position.x, position.z - guard.position.z) >= .84)) {
      actor.position.x = position.x; actor.position.z = position.z;
    }
  }
  assert.equal(path.length, 0, 'settled ranks must leave a usable aisle rather than trap the last soldier');
});

test('oncoming narrow-door traffic gives one member a stable right of way while the other actually backs out', () => {
  const priority = person(1, 0, 0), yielding = person(2, 0, -1.2, Math.PI);
  priority.intent = { x: 0, z: -1 }; yielding.intent = { x: 0, z: 1 };
  const options = { spacing: 1.2, constrained: true, dt: .05, now: 1,
    blocked: point => Math.abs(point.x) > .1 };
  const waiting = infantrySteering(priority, [yielding], { x: 0, z: -1 }, options);
  const retreat = infantrySteering(yielding, [priority], { x: 0, z: 1 }, options);
  assert.equal(waiting.speed, 0);
  assert.equal(priority.tactics.traffic.reason, 'wait-for-oncoming-yield');
  assert.ok(retreat.speed > 0 && retreat.z < 0);
  yielding.position.z = -1.7;
  assert.equal(infantrySteering(priority, [yielding], { x: 0, z: -1 }, options).speed, 1);
  assert.equal(priority.tactics.traffic.reason, 'right-of-way');
});

test('a right-of-way wait cannot suppress the existing bounded escape attempts indefinitely', () => {
  const actor = person(1, 0, 0), other = person(2, 0, -1.2, Math.PI);
  other.intent = { x: 0, z: 1 };
  const options = { spacing: 1.2, constrained: true, dt: .05, now: 1, blocked: () => false };
  for (let step = 0; step < 31; step++) infantrySteering(actor, [other], { x: 0, z: -1 }, options);
  assert.notEqual(actor.tactics.traffic.reason, 'wait-for-oncoming-yield');
});

test('a stationary guard merely facing the corridor does not receive oncoming movement priority', () => {
  const actor = person(1, 0, 0), guard = person(2, 0, -1.2, Math.PI);
  const result = infantrySteering(actor, [guard], { x: 0, z: -1 }, {
    spacing: 1.2, constrained: true, dt: .05, now: 1, blocked: () => false,
  });
  assert.ok(result.speed > 0);
  assert.notEqual(actor.tactics.traffic.reason, 'wait-for-oncoming-yield');
});

test('a retreating soldier can turn sideways around a stationary ally at the river edge', () => {
  const actor = person(182, 20.080162, -.774119);
  const ally = person(134, 20.147433, -1.676356);
  const path = [{ x: 20, z: -1 }, { x: 37, z: -13 }];
  const blocked = point => point.z > -.65;
  for (let step = 0; step < 500 && actor.position.x < 22; step++) {
    const waypoint = advanceInfantryPath(actor.position, path, point =>
      sihangRetreatBlockedWaypoint(actor, path[0], [ally]) &&
      sampledRouteClear(actor.position, point, (x, z) => !blocked({ x, z })), .2);
    const dx = waypoint.x - actor.position.x, dz = waypoint.z - actor.position.z;
    const steering = infantrySteering(actor, [ally], { x: dx, z: dz }, {
      spacing: 1.2, constrained: true, dt: .05, now: step * .05,
      lookAhead: Math.min(.65, Math.hypot(dx, dz)), holdShallowYield: true, blocked,
    });
    const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), .05, true);
    if (!turn.mayMove || !steering.speed) continue;
    const length = Math.min(Math.hypot(dx, dz), 2.7 * .05 * steering.speed * turn.moveScale);
    const next = { x: actor.position.x + turn.direction.x * length, z: actor.position.z + turn.direction.z * length };
    if (!blocked(next) && Math.hypot(next.x - ally.position.x, next.z - ally.position.z) >= .894) {
      actor.position.x = next.x; actor.position.z = next.z;
    }
  }
  assert.ok(actor.position.x >= 22, 'the soldier must leave the bank without crossing the ally or the obstacle');
});

test('a retreating soldier takes a swept-clear path beside a stationary ally at the river edge', () => {
  const actor = person(183, 20.198609, -.727935);
  const ally = person(134, 20.147433, -1.676356);
  const blocked = point => point.z > -.65;
  for (let step = 0; step < 300 && actor.position.x < 22; step++) {
    const dx = 65 - actor.position.x, dz = -14 - actor.position.z;
    const steering = infantrySteering(actor, [ally], { x: dx, z: dz }, {
      spacing: 1.2, constrained: true, dt: .05, now: step * .05,
      holdShallowYield: true, blocked,
    });
    const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), .05, true);
    if (!turn.mayMove || !steering.speed) continue;
    const length = 2.7 * .05 * steering.speed * turn.moveScale;
    const next = { x: actor.position.x + turn.direction.x * length, z: actor.position.z + turn.direction.z * length };
    if (!blocked(next) && Math.hypot(next.x - ally.position.x, next.z - ally.position.z) >= .9) {
      actor.position.x = next.x; actor.position.z = next.z;
    }
  }
  assert.ok(actor.position.x >= 22, 'a clear path must not be blocked by a wider advisory threshold');
});

test('a blocked retreat waypoint cannot be skipped through a wall or another floor', () => {
  const actor = person(182, 0, 0), ally = person(134, .6, 0);
  const wall = (_x, z) => z <= .3 || z >= .7;
  const route = [{ x: .6, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }];
  const check = point => sihangRetreatBlockedWaypoint(actor, route[0], [ally]) &&
    sampledRouteClear(actor.position, point, wall);
  assert.equal(advanceInfantryPath(actor.position, route, check, .2), route[0]);
  route[1].y = 3;
  assert.equal(advanceInfantryPath(actor.position, route, () => true, .2), route[0]);
});

test('a covering soldier can make physical space for a blocked retreat without crossing nearby bodies', () => {
  const actor = person(144, 40.891921, -17.69464);
  const waiting = person(180, 40.22841, -16.912818);
  waiting.tactics.traffic = { direction: { x: .185506, z: -.982643 } };
  const others = [waiting, person(142, 39.27171, -17.362874),
    person(145, 39.361655, -16.249706), person(153, 41.075256, -16.520925)];
  const clear = goal => sampledRouteClear(actor.position, goal, (x, z) => others.every(other =>
    Math.hypot(x - other.position.x, z - other.position.z) >=
      Math.min(.9, Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z) - .01)));
  const goal = sihangRetreatYieldPosition(actor, waiting, clear);
  assert.ok(goal && clear(goal));
  assert.ok(Math.hypot(goal.x - actor.position.x, goal.z - actor.position.z) <= 1.8 + 1e-8);
  assert.equal(sihangRetreatYieldPosition(actor, waiting, () => false), null);
});

test('short authored stair nodes do not inspect terrain beyond their actual destination', () => {
  const actor = person(1, 0, 0);
  const blocked = point => point.z < -.3;
  const options = { spacing: 1.2, constrained: true, blocked, lookAhead: .2 };
  const result = infantrySteering(actor, [], { x: 0, z: -.2 }, options);
  assert.deepEqual(result, { x: 0, z: -1, speed: 1, waitingFor: null });
  assert.throws(() => infantrySteering(actor, [], { x: 0, z: -.2 }, { ...options, lookAhead: 0 }), RangeError);
});

test('a narrow stair landing permits a short physical yield without requiring space beyond its edge', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -.8, Math.PI);
  other.intent = { x: 0, z: 1 };
  const blocked = point => Math.abs(point.x) > .55 || point.z > .55 || point.z < -1;
  const result = infantrySteering(actor, [other], { x: 0, z: -1 }, {
    spacing: 1.2, constrained: true, dt: .05, now: 1, lookAhead: .2, blocked,
  });
  assert.ok(result.speed > 0, 'the pair must separate instead of waiting forever on a small landing');
  assert.ok(Math.abs(result.x) > .9);
  assert.equal(blocked(actor.tactics.traffic.yieldPoint), false);
});

test('a held backward yield lasts through the real body turn before its walking window expires', () => {
  const actor = person(2, 0, -1.2, Math.PI), other = person(1, 0, 0);
  other.intent = { x: 0, z: -1 };
  const options = { spacing: 1.2, constrained: true, dt: .05, now: 1,
    blocked: point => Math.abs(point.x) > .1 };
  infantrySteering(actor, [other], { x: 0, z: 1 }, options);
  const destination = actor.tactics.traffic.yieldPoint;
  let mayMove = false;
  for (let step = 1; step <= 24 && !mayMove; step++) {
    const steering = infantrySteering(actor, [other], { x: 0, z: 1 }, { ...options, now: 1 + step * .05 });
    const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), .05, true);
    assert.equal(actor.tactics.traffic.yieldPoint, destination,
      'a still-clear retreat must not be replanned before the soldier finishes physically turning');
    mayMove = turn.mayMove;
  }
  assert.equal(mayMove, true);
});

test('a retreating soldier holds a shallow clear detour through its body turn', () => {
  const actor = person(2, 0, 0, 0), other = person(1, 0, -1.5);
  const options = { spacing: 1.2, constrained: false, dt: .05, now: 1,
    holdShallowYield: true, blocked: () => false };
  const first = infantrySteering(actor, [other], { x: 0, z: -1 }, options);
  assert.ok(first.x > 0 && first.z < 0);
  const destination = actor.tactics.traffic.yieldPoint;
  assert.ok(destination);
  other.position.x = -.3;
  const next = infantrySteering(actor, [other], { x: 0, z: -1 }, { ...options, now: 1.05 });
  assert.equal(actor.tactics.traffic.yieldPoint, destination);
  assert.ok(next.x > 0 && next.z < 0, 'a brief direct opening must not interrupt a still-clear physical detour');
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

test('a short stair-step reservation cannot prevent a close pair from separating', () => {
  const actor = person(1, .1, 0), other = person(2, -.7, -.23);
  const reservations = new Map([[other.id, { x: -.4, z: -.23 }]]);
  const result = infantrySteering(actor, [other], { x: 0, z: .24 }, {
    spacing: 1.2, constrained: true, dt: .05, now: 1, reservations, lookAhead: .24,
    blocked: point => point.x < -.1 || point.x > .2,
  });
  assert.equal(result.speed, 1);
  assert.equal(result.z, 1);
  assert.ok(Math.hypot(actor.position.x - other.position.x, .24 - other.position.z) >
    Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z));
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
