import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstructionState, resetConstructionState, selectConstructionBlueprint, constructionCandidate, advanceConstruction } from '../src/construction.js';
import { SPAWN_RULES } from '../src/spawns.js';

const input = overrides => ({ builderId: 'engineer-1', position: { x: 0, y: 0, z: 78 },
  candidate: { x: 0, y: 0, z: 73 }, holding: true, allowed: true, ...overrides });
function fixture() {
  const state = createConstructionState();
  selectConstructionBlueprint(state, 'engineer-1');
  return state;
}

test('placement derives from entity heading and shared ground support, without camera or DOM state', () => {
  const origin = { x: 3, y: 0, z: 10 };
  assert.deepEqual(constructionCandidate(origin, 0, () => .45), { x: 3, y: .45, z: 5 });
  const left = constructionCandidate(origin, Math.PI / 2, () => 0);
  assert.ok(Math.abs(left.x + 2) < 1e-10);
  assert.ok(Math.abs(left.z - 10) < 1e-10);
  assert.deepEqual(origin, { x: 3, y: 0, z: 10 });
  assert.equal(SPAWN_RULES.buildRange, 5);
});
test('a held build locks its actual site; repeated blueprint selection preserves progress, release cancels it', () => {
  const state = fixture(), data = input();
  advanceConstruction(state, data, 2, () => null);
  data.candidate.x = 20;
  data.position.x = .2;
  advanceConstruction(state, data, .1, () => null);
  assert.equal(state.progress, 2.1);
  assert.equal(state.site.x, 0);
  assert.equal(state.preview.x, 0);
  selectConstructionBlueprint(state, 'engineer-1');
  assert.equal(state.progress, 2.1);
  assert.equal(advanceConstruction(state, { ...data, holding: false }, .1, () => null).completed, null);
  assert.equal(state.progress, 0);
  assert.equal(state.site, null);
  assert.equal(state.blueprint, true);
  assert.equal(state.builderId, 'engineer-1');
  advanceConstruction(state, { ...data, holding: false }, .1, () => null);
  assert.equal(state.preview.x, 20);
});
test('movement above the existing .7m anchor limit restarts held construction at the new candidate', () => {
  const state = fixture();
  advanceConstruction(state, input(), 2, () => null);
  advanceConstruction(state, input({ position: { x: .7, y: 0, z: 78 } }), .1, () => null);
  assert.equal(state.progress, 2.1);
  const moved = input({ position: { x: .71, y: 0, z: 78 }, candidate: { x: 2, y: 0, z: 73 } });
  const result = advanceConstruction(state, moved, .1, () => null);
  assert.equal(result.notice, 'moved');
  assert.equal(state.progress, .1);
  assert.equal(state.site.x, 2);
  assert.equal(state.anchor.x, .71);
});
test('live placement checks block and clear progress rather than allowing a HUD preview to authorize a build', () => {
  const state = fixture(), checked = [];
  advanceConstruction(state, input(), 2, () => null);
  const result = advanceConstruction(state, input({ candidate: { x: 40, y: 0, z: 73 } }), 10, point => {
    checked.push({ ...point });
    return '附近有敌军，不能建造';
  });
  assert.deepEqual(checked, [{ x: 0, y: 0, z: 73 }]);
  assert.equal(result.completed, null);
  assert.equal(state.mode, 'blocked');
  assert.equal(state.blockedReason, '附近有敌军，不能建造');
  assert.equal(state.progress, 0);
  assert.equal(state.site, null);
  advanceConstruction(state, input(), .1, () => null);
  assert.equal(state.progress, .1);
});
test('another member or invalid construction context cannot inherit a previous engineer unfinished build', () => {
  const state = fixture();
  advanceConstruction(state, input(), 5.9, () => null);
  assert.equal(advanceConstruction(state, input({ builderId: 'engineer-2' }), 1, () => null).notice, 'owner-changed');
  assert.deepEqual(state, createConstructionState());
  selectConstructionBlueprint(state, 'engineer-2');
  advanceConstruction(state, input({ builderId: 'engineer-2' }), 2, () => null);
  assert.equal(advanceConstruction(state, input({ builderId: 'engineer-2', allowed: false }), 10, () => null).notice, 'unavailable');
  assert.deepEqual(state, createConstructionState());
});
test('completion is a single immutable original-builder result, not a repeated effect of continuing to hold', () => {
  const state = fixture(), data = input();
  const result = advanceConstruction(state, data, SPAWN_RULES.buildSeconds, () => null);
  assert.equal(result.completed.builderId, 'engineer-1');
  assert.deepEqual(result.completed.position, data.candidate);
  data.candidate.x = 999;
  assert.equal(result.completed.position.x, 0);
  assert.throws(() => { result.completed.position.x = 1; }, TypeError);
  assert.deepEqual(state, createConstructionState());
  assert.equal(advanceConstruction(state, input(), 10, () => null).completed, null);
});
test('30/60/144Hz keep the six-second build threshold, while reset removes all unfinished state', () => {
  for (const fps of [30, 60, 144]) {
    const state = fixture();
    let frames = 0, completed = null;
    while (!completed && frames++ < fps * 7) completed = advanceConstruction(state, input(), 1 / fps, () => null).completed;
    assert.ok(completed);
    assert.ok(Math.abs(frames / fps - SPAWN_RULES.buildSeconds) <= 1 / fps + 1e-10);
    assert.equal(completed.builderId, 'engineer-1');
  }
  const state = fixture();
  advanceConstruction(state, input(), 2, () => null);
  const before = structuredClone(state);
  advanceConstruction(state, input(), 0, () => null);
  assert.deepEqual(state, before);
  resetConstructionState(state);
  assert.deepEqual(state, createConstructionState());
});
test('invalid positions, clocks, ownership and validation results fail explicitly', () => {
  assert.throws(() => selectConstructionBlueprint(createConstructionState(), ''), /builder identity/);
  assert.throws(() => constructionCandidate({ x: NaN, y: 0, z: 0 }, 0, () => 0), RangeError);
  assert.throws(() => constructionCandidate({ x: 0, y: 0, z: 0 }, Infinity, () => 0), RangeError);
  assert.throws(() => constructionCandidate({ x: 0, y: 0, z: 0 }, 0, () => NaN), RangeError);
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceConstruction(fixture(), input(), dt, () => null), RangeError);
  assert.throws(() => advanceConstruction(fixture(), input({ holding: 'yes' }), .1, () => null), RangeError);
  assert.throws(() => advanceConstruction(fixture(), input({ allowed: undefined }), .1, () => null), RangeError);
  for (const result of [undefined, false, 0, '']) assert.throws(() => advanceConstruction(fixture(), input(), .1, () => result), /reason or null/);
  assert.throws(() => advanceConstruction(fixture(), input(), .1, () => { throw new Error('placement failure'); }), /placement failure/);
});
