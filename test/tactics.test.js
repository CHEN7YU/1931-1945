import test from 'node:test';
import assert from 'node:assert/strict';
import { createTactics, rememberThreat, expireThreat, peekTurn, selectCover, advancePosition, pointSegmentDistance,
  friendlyCoverAction, targetAimPoint, observeVisualThreat } from '../src/tactics.js';

test('threat memory copies only observed position and expires without tracking an unseen actor', () => {
  const state = createTactics(1, 1, 0), target = { x: 4, y: 1.2, z: 8 };
  rememberThreat(state, target, 10);
  target.x = 100;
  assert.equal(state.lastSeen.x, 4);
  assert.equal(expireThreat(state, 14.9), false);
  assert.equal(expireThreat(state, 15.1), true);
  assert.equal(state.lastSeen, null);
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
test('squad approach lanes diverge but all cross the actual bridge corridor', () => {
  const goal = { x: -12, z: 30 };
  const a = advancePosition(createTactics(1, 0, 0), { x: 9, z: -70 }, goal);
  const b = advancePosition(createTactics(2, 1, 0), { x: 9, z: -70 }, goal);
  assert.ok(Math.abs(a.x - b.x) > 10);
  for (let i = 0; i < 4; i++) {
    const bridge = advancePosition(createTactics(i, i, i), { x: 8, z: -24 }, goal);
    assert.ok(bridge.x > 4 && bridge.x < 12 && bridge.z === -6);
  }
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
