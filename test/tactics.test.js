import test from 'node:test';
import assert from 'node:assert/strict';
import { createTactics, rememberThreat, expireThreat, peekTurn, selectCover, advancePosition, pointSegmentDistance,
  friendlyCoverAction, targetAimPoint, observeVisualThreat, objectiveDestination, objectiveAdvanceRequired,
  assignAssaultObjectives, assaultDestination, enemyAssaultAction, formationAssaultAction, resetObjectiveMovement, followGuardAction, coverPeeks } from '../src/tactics.js';
import { makeObjectives, advanceCapture } from '../src/core.js';
import { battleRoster } from '../src/battle-roster.js';

test('a standing shield carrier can be observed through a genuinely visible head, never through an opaque shield', () => {
  const state = createTactics(1, 1, 0), target = { id: 'shield-carrier', targetKind: 'person',
    position: { x: 0, y: 0, z: -30 }, stance: 'standing',
    nativeMotion: { profile: {}, posture: {} }, sihangShield: { active: true } };
  assert.equal(observeVisualThreat(state, target, 1, () => false), null);
  const head = observeVisualThreat(state, target, 2, point => point.y > 1.55);
  assert.ok(head.y > 1.55);
  assert.equal(state.threatId, target.id);
  target.sihangShield.active = false;
  assert.equal(observeVisualThreat(state, target, 3, point => point.y > 1.55), null);
});

test('sandbag firing peeks stay behind the barrier instead of stepping through its collision volume', () => {
  const slot = { kind: 'sandbag', x: 1, z: 2 };
  assert.deepEqual(coverPeeks(slot), [{ x: 1, z: 2 }]);
});

function followingPair(range = 3, speed = 0) {
  return {
    actor: { friendly: true, playerUnit: true, order: 'follow', position: { x: range, y: 0, z: 0 },
      tactics: createTactics(2, 100, 1) },
    player: { id: 'leader', position: { x: 0, y: 0, z: 0 }, heading: 0, locomotion: { speed } },
    objective: { x: 0, z: -50 },
  };
}

test('followers within three metres guard even while the player moves, with stable sectors and stances', () => {
  const { actor, player, objective } = followingPair(3, 2);
  const guard = followGuardAction(actor, player, objective);
  assert.equal(guard.stance, 'crouched');
  assert.ok(Math.cos(guard.heading) > .7, 'watch the known front, not the rear follow slot');
  player.heading = 2;
  actor.position.x = 3.01;
  assert.equal(followGuardAction(actor, player, objective), guard, 'distance noise and looking around do not retask guards');
  actor.position.x = 4.5;
  assert.equal(followGuardAction(actor, player, objective), guard);
  actor.position.x = 4.51;
  assert.equal(followGuardAction(actor, player, objective), null);
  assert.equal(actor.tactics.followGuard, null);
  actor.position.x = 3.01;
  assert.equal(followGuardAction(actor, player, objective), null, 'must close to three metres before guarding again');
});

test('a stopped player lets the local squad spread and guard, but cannot strand distant or upstairs followers', () => {
  const { actor, player, objective } = followingPair(8);
  assert.ok(followGuardAction(actor, player, objective));
  player.locomotion.speed = .11;
  assert.equal(followGuardAction(actor, player, objective), null, 'follow again when the leader walks away');
  player.locomotion.speed = 0;
  actor.position.x = 8.01;
  assert.equal(followGuardAction(actor, player, objective), null);
  actor.position.x = 2; actor.position.y = 3.2;
  assert.equal(followGuardAction(actor, player, objective), null, 'same horizontal coordinates on another floor still require a path');
});

test('guarding does not replace explicit orders or autonomous formations and resets on leader changes', () => {
  for (const patch of [{ order: 'hold' }, { order: 'advance' }, { playerUnit: false }, { friendly: false }]) {
    const { actor, player, objective } = followingPair();
    followGuardAction(actor, player, objective);
    Object.assign(actor, patch);
    assert.equal(followGuardAction(actor, player, objective), null);
    assert.equal(actor.tactics.followGuard, null);
  }
  const { actor, player, objective } = followingPair();
  const previous = followGuardAction(actor, player, objective);
  player.id = 'replacement';
  assert.notEqual(followGuardAction(actor, player, objective), previous);
  const sectors = new Set(), stances = new Set();
  for (let slot = 0; slot < 11; slot++) {
    actor.tactics = createTactics(slot + 1, 100, slot);
    const guard = followGuardAction(actor, player, objective);
    sectors.add(guard.heading); stances.add(guard.stance);
  }
  assert.equal(sectors.size, 11);
  assert.deepEqual([...stances].sort(), ['crouched', 'standing']);
  assert.throws(() => followGuardAction(actor, player, null), RangeError);
});

test('capture frees every surplus friendly guard and invalidates the old firing and navigation task', () => {
  const formations = battleRoster(), points = makeObjectives();
  for (const formation of formations) formation.members = [{ health: 100, position: { x: 0, z: 48 },
    tactics: createTactics(formation.index, formation.index, 0), path: [{ x: 0, z: 48 }], nextPath: 99 }];
  assignAssaultObjectives(formations, points);
  const attackers = formations.filter(unit => unit.team === 'friendly' && !unit.player && unit.objectiveId === 'A');
  for (const unit of attackers) {
    const state = unit.members[0].tactics;
    state.cover = { id: 'old-point-cover' }; state.enteredCover = true;
    state.personalSlot = { objectiveId: 'A', point: { x: 0, z: 48 } };
    state.shotMovePending = true; state.relocatedFireUntil = 90;
    state.lastSeen = { x: 20, y: 1.4, z: 48 };
  }
  advanceCapture(points[0], 12, true, false);
  const changed = assignAssaultObjectives(formations, points);
  assert.equal(attackers.filter(unit => unit.objectiveId === 'A').length, 1);
  for (const formation of attackers.filter(unit => unit.objectiveId !== 'A')) {
    assert.ok(changed.includes(formation));
    const actor = formation.members[0], position = { ...actor.position };
    resetObjectiveMovement(actor, formation.objectiveId);
    assert.equal(actor.tactics.cover, null); assert.equal(actor.tactics.personalSlot, null);
    assert.equal(actor.tactics.shotMovePending, false); assert.equal(actor.tactics.relocatedFireUntil, 0);
    assert.equal(actor.path, null); assert.equal(actor.nextPath, 0);
    assert.equal(actor.tactics.objectiveId, formation.objectiveId);
    assert.deepEqual(actor.position, position, 'handoff cannot teleport soldiers');
    assert.deepEqual(actor.tactics.lastSeen, { x: 20, y: 1.4, z: 48 }, 'known threats remain known');
  }
  assert.ok(changed.every(formation => !formation.player), 'autonomous assignment does not overwrite explicit player orders');
  assert.throws(() => resetObjectiveMovement(null, 'B'), RangeError);
});

test('friendly covering elements also advance instead of permanently pinning the same soldiers to old cover', () => {
  const point = makeObjectives()[1], position = { x: 0, z: 42 };
  for (let slot = 0; slot < 11; slot++) {
    const state = createTactics(slot + 1, 100, slot), decisions = new Set();
    for (let time = 0; time < 12; time += .25) decisions.add(formationAssaultAction(state, position, point, time, true));
    assert.ok(decisions.has('advance') && decisions.has('cover'), `slot ${slot} alternates with its covering element`);
    assert.equal(formationAssaultAction(state, position, point, 13, false), 'advance');
  }
});

test('both armies distribute real formations across three simultaneous goals and retask after ownership changes', () => {
  const formations = battleRoster(), points = makeObjectives();
  for (const formation of formations) formation.members = [{ health: 100, position: { x: 0, z: formation.team === 'friendly' ? 82 : -82 } }];
  const before = structuredClone(formations);
  assignAssaultObjectives(formations, points);
  for (const team of ['friendly', 'enemy']) {
    const units = formations.filter(item => item.team === team && !item.player);
    assert.equal(new Set(units.map(item => item.objectiveId)).size, 3);
    const loads = points.map(point => units.filter(item => item.objectiveId === point.id).length);
    assert.ok(Math.max(...loads) - Math.min(...loads) <= 1);
  }
  const initialC = formations.filter(item => item.team === 'enemy' && item.objectiveId === 'C').length;
  advanceCapture(points[2], 12, false, true);
  assignAssaultObjectives(formations, points);
  assert.ok(formations.filter(item => item.team === 'enemy' && item.objectiveId === 'C').length < initialC,
    'holding the northern point frees units to attack instead of parking the whole force there');
  assert.deepEqual(formations.map(({ objectiveId, ...unit }) => unit), before, 'assignment cannot spawn, revive or relocate soldiers');
});

test('secured points retain one guard while attackers stay committed instead of oscillating across objectives', () => {
  const formations = battleRoster(), points = makeObjectives();
  for (const formation of formations) formation.members = [{ health: 100, position: { x: formation.index * 8, z: -82 } }];
  assignAssaultObjectives(formations, points);
  const original = formations.map(unit => unit.objectiveId);
  for (let round = 0; round < 10; round++) {
    for (const formation of formations) formation.members[0].position.x *= -1;
    assignAssaultObjectives(formations, points);
    assert.deepEqual(formations.map(unit => unit.objectiveId), original, 'motion and changing distance alone do not reverse an attack');
  }
  for (const point of points.slice(1)) advanceCapture(point, 12, false, true);
  assignAssaultObjectives(formations, points);
  const enemies = formations.filter(unit => unit.team === 'enemy');
  assert.equal(enemies.filter(unit => unit.objectiveId === 'A').length, 8);
  assert.equal(enemies.filter(unit => unit.objectiveId === 'B').length, 1);
  assert.equal(enemies.filter(unit => unit.objectiveId === 'C').length, 1);
  formations.find(unit => unit.team === 'enemy' && unit.objectiveId === 'A').members[0].health = 0;
  assignAssaultObjectives(formations, points);
  assert.equal(enemies.filter(unit => unit.members[0].health > 0 && unit.objectiveId === 'A').length, 7);
});

test('every formation member targets a stable destination well inside its capture circle', () => {
  for (const point of makeObjectives()) for (let formation = 0; formation < 10; formation++) for (let index = 0; index < 11; index++) {
    const actor = { index, formation: { index: formation }, position: { x: 0, z: -82 } };
    const goal = assaultDestination(actor, point);
    assert.ok(Math.hypot(goal.x - point.x, goal.z - point.z) < point.radius - 2);
    actor.position.z += 1;
    assert.deepEqual(assaultDestination(actor, point), goal, 'moving does not invalidate the path request every step');
  }
});

test('enemy rifle sections alternate bounded cover and objective advances despite continuous visual contact', () => {
  const point = makeObjectives()[0], position = { x: 8, z: -30 };
  const a = createTactics(1, 1, 0), b = createTactics(2, 1, 1);
  for (let now = 0; now < 24; now += .25) {
    assert.notEqual(enemyAssaultAction(a, position, point, now, true), enemyAssaultAction(b, position, point, now, true));
    assert.equal(enemyAssaultAction(a, position, point, now, false), 'advance', 'heard shots alone cannot pin an entire assault');
  }
  rememberThreat(a, { x: 0, y: 1, z: 0 }, 0);
  let moving = 0;
  for (let now = 0; now < 24; now += .25) {
    a.suppressedUntil = now + 3;
    if (enemyAssaultAction(a, position, point, now, true) === 'advance') moving += .25;
  }
  assert.ok(moving >= 7, `persistent suppression still leaves genuine advance windows: ${moving}`);
  a.threatKind = 'closed-armor';
  assert.equal(enemyAssaultAction(a, position, point, 25, true), 'cover', 'unarmed riflemen retain armor evasion');
});

test('threat memory copies only observed position and expires without tracking an unseen actor', () => {
  const state = createTactics(1, 1, 0), target = { x: 4, y: 1.2, z: 8 };
  rememberThreat(state, target, 10);
  target.x = 100;
  assert.equal(state.lastSeen.x, 4);
  assert.equal(expireThreat(state, 14.9), false);
  assert.equal(expireThreat(state, 15.1), true);
  assert.equal(state.lastSeen, null);
});

test('friendly capture assignments stay inside the objective with stable squad lanes and respect player orders', () => {
  const objective = { id: 'A', x: -12, z: 30, radius: 13 }, position = { x: 0, z: 70 };
  const goals = new Set();
  for (let squad = 0; squad < 10; squad++) for (let slot = 0; slot < 10; slot++) {
    const tactics = createTactics(squad * 10 + slot, squad, slot), actor = { friendly: true, playerUnit: false, position, tactics };
    const goal = objectiveDestination(tactics, position, objective);
    assert.ok(Math.hypot(goal.x - objective.x, goal.z - objective.z) < objective.radius - 1);
    assert.deepEqual(goal, objectiveDestination(tactics, { x: 4, z: 60 }, objective));
    goals.add(`${goal.x},${goal.z}`);
    assert.equal(objectiveAdvanceRequired(actor, objective, 55), slot % 4 !== 0);
    assert.equal(objectiveAdvanceRequired({ ...actor, playerUnit: true, order: 'hold' }, objective, 55), false);
    assert.equal(objectiveAdvanceRequired({ ...actor, playerUnit: true, order: 'follow' }, objective, 55), false);
    assert.equal(objectiveAdvanceRequired({ ...actor, playerUnit: true, order: 'advance' }, objective, 55), slot % 4 !== 0);
    assert.equal(objectiveAdvanceRequired({ ...actor, position: objective }, objective, 55), false);
    assert.equal(objectiveAdvanceRequired(actor, objective, 12), false);
  }
  assert.ok(goals.size >= 25);
});
test('paired squad roles alternate peeking rather than all exposing simultaneously', () => {
  const a = createTactics(1, 1, 0), b = createTactics(2, 1, 1);
  for (let t = 0; t < 10; t += .25) assert.notEqual(peekTurn(a, t), peekTurn(b, t));
  a.suppressedUntil = 10; a.arrivedAt = 5;
  assert.equal(peekTurn(a, 5.5), false);
});
test('cover selection requires real shielding, a clear firing peek, a route and an unclaimed slot', () => {
  const claims = new Map(), a = createTactics(1, 1, 0), b = createTactics(2, 1, 1);
  const slots = [
    { id: 'exposed', x: 1, z: 0, kind: 'window' },
    { id: 'unreachable', x: 2, z: 0, kind: 'window' },
    { id: 'good-a', x: 3, z: 0, kind: 'window' },
    { id: 'good-b', x: 4, z: 0, kind: 'window' },
  ];
  const context = { position: { x: 0, z: 0 }, threat: { x: 10, z: 0 }, slots, claims, now: 1, blocked: () => false,
    protectedAt: slot => slot.id !== 'exposed', seesTarget: () => true, pathTo: slot => slot.id === 'unreachable' ? [] : [{ x: slot.x, z: slot.z }] };
  const first = selectCover({ ...context, state: a });
  assert.equal(first.cover.id, 'good-a');
  const second = selectCover({ ...context, state: b });
  assert.equal(second.cover.id, 'good-b');
  assert.equal(claims.get('good-a').owner, a.id);
  assert.equal(selectCover({ ...context, state: createTactics(3, 1, 2), seesTarget: () => false }), null);
});
test('near-miss distance is bounded by the actual shot segment', () => {
  assert.equal(pointSegmentDistance({ x: 5, z: 1 }, { x: 0, z: 0 }, { x: 10, z: 0 }).distance, 1);
  assert.ok(pointSegmentDistance({ x: 20, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }).distance === 10);
});
test('friendly cover approach and withdrawal have distinct urgent movement without firing on the move', () => {
  const state = createTactics(1, 1, 0);
  state.cover = { id: 'wall', x: 0, z: 0, peek: { x: 1, z: 0 } };
  let action = friendlyCoverAction(state, { x: 8, z: 0 }, 10.4);
  assert.equal(action.mode, 'rush-to-cover');
  assert.equal(action.sprint, true);
  assert.equal(action.mayFire, false);
  state.enteredCover = true;
  action = friendlyCoverAction(state, state.cover, 10.4);
  assert.equal(action.mode, 'move-to-peek');
  assert.equal(action.sprint, false);
  assert.equal(action.mayFire, false);
  action = friendlyCoverAction(state, state.cover.peek, 10.4);
  assert.equal(action.mode, 'peek');
  assert.equal(action.mayFire, true);
  state.suppressedUntil = 20;
  action = friendlyCoverAction(state, state.cover.peek, 10.4);
  assert.equal(action.mode, 'withdraw-to-cover');
  assert.equal(action.sprint, true);
  assert.equal(action.mayFire, false, 'pressure still forces cover long after the initial arrival grace period');
});
test('invalid cover action inputs fail explicitly rather than inventing a safe position', () => {
  assert.throws(() => friendlyCoverAction(createTactics(2, 1, 1), { x: 0, z: 0 }, 1), RangeError);
  const state = createTactics(1, 1, 0);
  state.cover = { x: 0, z: 0, peek: { x: 1, z: 0 } };
  assert.throws(() => friendlyCoverAction(state, { x: NaN, z: 0 }, 1), RangeError);
  assert.throws(() => friendlyCoverAction(state, { x: 0, z: 0 }, -1), RangeError);
});
test('a moving hidden target cannot refresh position, identity or memory lifetime without a successful visibility query', () => {
  const state = createTactics(1, 1, 0);
  const target = { id: 'soldier-2', targetKind: 'person', position: { x: 4, y: .45, z: 8 } };
  const seen = observeVisualThreat(state, target, 1, () => true);
  assert.deepEqual(seen, { x: 4, y: 1.55, z: 8 });
  assert.equal(state.threatId, target.id);
  assert.equal(state.threatSense, 'vision');
  const before = structuredClone(state);
  target.position.x = 50;
  target.targetKind = 'closed-armor';
  for (const now of [1.1, 2, 5.9]) assert.equal(observeVisualThreat(state, target, now, () => false), null);
  assert.deepEqual({ ...state, lastSightCheck: null }, { ...before, lastSightCheck: null },
    'hidden movement and type changes do not leak into tactical memory');
  assert.equal(state.lastSightCheck.visible, false);
  seen.z = -100;
  assert.equal(state.lastSeen.z, 8);
  assert.equal(expireThreat(state, 6.001), true, 'failed attempts do not extend memory even if sensing is delayed');
  assert.equal(state.threatId, null);
  assert.equal(state.observedAt, null);
  const reacquired = observeVisualThreat(state, target, 7, point => point.x === 50);
  assert.equal(reacquired.x, 50);
  assert.equal(state.threatKind, 'closed-armor');
  assert.equal(state.observedAt, 7);
});
test('sound remembers an imprecise event position without borrowing a live target identity or the visual lifetime', () => {
  const state = createTactics(1, 1, 0);
  rememberThreat(state, { x: 1, y: 1, z: 2 }, 1, 'closed-armor', 'vision', 'soldier-2');
  const heard = { x: 8, y: 1, z: 20 };
  rememberThreat(state, heard, 2, 'person', 'sound');
  heard.x = 100;
  assert.equal(state.lastSeen.x, 8);
  assert.equal(state.threatId, null);
  assert.equal(state.threatSense, 'sound');
  assert.equal(state.forgetAt, 5);
  assert.equal(expireThreat(state, 5.001), true);
});
test('perception rejects invalid observations and propagates visibility errors instead of inventing a successful sighting', () => {
  const state = createTactics(1, 1, 0);
  const target = { id: 'soldier-2', targetKind: 'person', position: { x: 0, y: 0, z: 0 } };
  assert.throws(() => observeVisualThreat(state, target, NaN, () => false), RangeError);
  assert.throws(() => observeVisualThreat(state, target, 1, () => { throw new Error('trace failed'); }), /trace failed/);
  assert.equal(state.lastSeen, null);
  assert.throws(() => rememberThreat(state, { x: 1, z: 2 }, 1), RangeError);
  assert.throws(() => rememberThreat(state, target.position, 1, 'person', 'unknown'), RangeError);
  assert.throws(() => targetAimPoint({ position: { x: NaN, y: 0, z: 0 } }), RangeError);
  assert.throws(() => expireThreat(state, Infinity), RangeError);
});
