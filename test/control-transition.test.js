import test from 'node:test';
import assert from 'node:assert/strict';
import { DEATH_TRANSFER, createDeathTransfer, startDeathTransfer, advanceDeathTransfer, deathTransferMask,
  resetDeathTransfer, nearbyDeathTransferMember } from '../src/control-transition.js';
import { nextAlive } from '../src/core.js';

test('death feedback precedes handoff and the next member cannot play until the transition ends', () => {
  const state = createDeathTransfer();
  assert.equal(startDeathTransfer(state, 's1', 'rifle'), true);
  assert.equal(startDeathTransfer(state, 's1', 'rifle'), false);
  assert.equal(advanceDeathTransfer(state, .59), null);
  assert.equal(state.handedOff, false); assert.ok(deathTransferMask(state).red > 0);
  assert.equal(advanceDeathTransfer(state, .02), 'handoff');
  assert.equal(state.active, true); assert.equal(deathTransferMask(state).red, 0);
  assert.equal(advanceDeathTransfer(state, 1.99), null);
  assert.ok(Math.abs(deathTransferMask(state).opacity - 1) < 1e-8,
    'the identity card remains fully visible for the added second');
  assert.equal(advanceDeathTransfer(state, .15), null);
  assert.ok(Math.abs(deathTransferMask(state).opacity - .5) < 1e-8, 'the original short fade is preserved');
  assert.equal(advanceDeathTransfer(state, .151), 'complete');
  assert.equal(state.active, false); assert.equal(deathTransferMask(state).opacity, 0);
});
test('pause/disabled visual feedback cannot shorten the simulation-clock transfer', () => {
  const a = createDeathTransfer(), b = createDeathTransfer();
  startDeathTransfer(a, 's1', 'blast'); startDeathTransfer(b, 's1', 'blast');
  advanceDeathTransfer(a, .2);
  assert.equal(advanceDeathTransfer(a, 0), null);
  advanceDeathTransfer(b, .2);
  assert.deepEqual(a, b);
  assert.equal(DEATH_TRANSFER.durationSeconds, 2.9);
  assert.equal(DEATH_TRANSFER.fadeSeconds, .3);
  assert.throws(() => advanceDeathTransfer(a, -1), RangeError);
});
test('a new selected member dying restarts feedback, while resetting removes pending work', () => {
  const state = createDeathTransfer();
  const memorial = { name: '汪洋', unitName: '国民革命军第88师战士', birthYear: 1912, deathYear: 1937 };
  startDeathTransfer(state, 's1', 'rifle', memorial); advanceDeathTransfer(state, .7);
  assert.deepEqual(state.memorial, memorial);
  assert.equal(startDeathTransfer(state, 's2', 'blast', { ...memorial, name: '王勇' }), true);
  assert.equal(state.elapsed, 0); assert.equal(state.handedOff, false);
  assert.equal(state.memorial.name, '王勇');
  resetDeathTransfer(state);
  assert.equal(advanceDeathTransfer(state, 10), null);
  assert.equal(state.fromId, null);
  assert.equal(state.memorial, null);
});
test('handoff rechecks survivors at the cut, including a candidate killed during the feedback interval', () => {
  const state = createDeathTransfer(), members = [{ health: 0 }, { health: 100 }, { health: 100 }];
  startDeathTransfer(state, 's0', 'blast');
  advanceDeathTransfer(state, .3);
  members[1].health = 0;
  assert.equal(advanceDeathTransfer(state, .31), 'handoff');
  assert.equal(nextAlive(members, 0), 2);
  members[2].health = 0;
  assert.equal(nextAlive(members, 0), -1, 'a wipe routes to deployment instead of a dead candidate');
});
test('30/60/144Hz use the same transfer duration with only frame-quantization differences', () => {
  for (const fps of [30, 60, 144]) {
    const state = createDeathTransfer();
    startDeathTransfer(state, 's1', 'rifle');
    let handoffAt = null, completeAt = null;
    for (let frame = 1; frame <= fps * 3; frame++) {
      const event = advanceDeathTransfer(state, 1 / fps);
      if (event === 'handoff') handoffAt = frame / fps;
      if (event === 'complete') { completeAt = frame / fps; break; }
    }
    assert.ok(handoffAt >= DEATH_TRANSFER.handoffSeconds && handoffAt <= DEATH_TRANSFER.handoffSeconds + 1 / fps + 1e-9);
    assert.ok(completeAt >= DEATH_TRANSFER.durationSeconds && completeAt <= DEATH_TRANSFER.durationSeconds + 1 / fps + 1e-9);
  }
});

test('automatic foot-squad handoff favors a nearby survivor on the same level', () => {
  const member = (x, y, health = 100, excluded = false) => ({ position: { x, y, z: 0 }, health, excluded });
  const members = [member(0, 0, 0), member(30, 0), member(1, 7.2), member(1, 0, 0),
    member(1, 0, 100, true), member(4, 0)];
  const eligible = actor => !actor.excluded;
  assert.equal(nearbyDeathTransferMember(members, 0, eligible), 5);
  members[5].health = 0;
  assert.equal(nearbyDeathTransferMember(members, 0, eligible), 2);
  assert.equal(nearbyDeathTransferMember(members, 0, () => false), -1);
});
