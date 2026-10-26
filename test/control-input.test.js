import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlInput } from '../src/control-input.js';
import { createControlEvents } from '../src/control-events.js';

const owner = (soldierId = 's1', vehicleId = null) => ({ unitId: 'u1', soldierId, vehicleId,
  seatId: vehicleId ? `${vehicleId}:seat-0` : null, weaponId: vehicleId ? `${vehicleId}:primary` : `${soldierId}:rifle` });
test('immediate commands are owned by the actual soldier and cannot be applied twice', () => {
  const input = createControlInput(), source = owner();
  input.bind(source);
  const command = input.capture('reload');
  let reloads = 0;
  assert.equal(input.execute(command, source, true, () => reloads++).status, 'applied');
  assert.equal(input.execute(command, source, true, () => reloads++).reason, 'duplicate');
  assert.equal(reloads, 1);
});
test('Y, seat changes and returning to the same soldier invalidate old operations and held input', () => {
  const input = createControlInput(), first = owner(), second = owner('s2');
  input.bind(first);
  input.keys.add('KeyW'); input.held.primary = input.held.secondary = input.held.aiming = true;
  input.held.orderStarted = 100;
  const old = input.capture('reload');
  input.bind(second);
  assert.equal(input.keys.size, 0);
  assert.deepEqual(input.held, { primary: false, secondary: false, aiming: false, orderStarted: null });
  assert.equal(input.execute(old, second, true, () => assert.fail('old soldier operation executed')).reason, 'stale-owner');
  const onFoot = input.capture('pressFire');
  input.bind(owner('s2', 'tank'));
  assert.equal(input.execute(onFoot, owner('s2', 'tank'), true, () => assert.fail('old rifle intent fired cannon')).reason, 'stale-owner');
  const aboard = input.capture('interact');
  input.bind(second); input.bind(owner('s2', 'tank'));
  assert.equal(input.execute(aboard, owner('s2', 'tank'), true, () => assert.fail('old F intent replayed after returning')).reason, 'stale-owner');
});
test('pause/death/menu invalidate input even if the selected soldier ID has not changed', () => {
  const input = createControlInput(), source = owner();
  input.bind(source);
  const command = input.capture('cycleMember');
  input.block();
  assert.equal(input.execute(command, source, false, () => assert.fail()).reason, 'inactive');
  input.bind(source, false);
  assert.equal(input.snapshot.enabled, false);
  input.bind(source);
  const pending = input.capture('reload');
  input.reset(); input.bind(source);
  assert.equal(input.execute(pending, source, true, () => assert.fail()).reason, 'stale-owner');
});
test('owner checks include weapon/seat identity and invalid actions are explicit errors', () => {
  const input = createControlInput(), source = owner('s1', 'v1');
  input.bind(source);
  assert.equal(input.execute(input.capture('pressFire'), { ...source, seatId: 'other-seat' }, true, () => assert.fail()).reason, 'stale-owner');
  assert.equal(input.execute(input.capture('pressFire'), { ...source, weaponId: 'other-gun' }, true, () => assert.fail()).reason, 'stale-owner');
  assert.throws(() => input.capture('cheat'), RangeError);
  assert.throws(() => input.capture('look', { x: NaN, y: 0 }), RangeError);
  assert.throws(() => input.capture('startOrder', {}), RangeError);
  assert.throws(() => input.capture('reload', null), RangeError);
  assert.throws(() => input.execute({ action: 'reload' }, source, true, () => {}), /originate/);
  for (let i = 0; i < 100; i++) input.execute(input.capture('look', { x: 0, y: 0 }), source, true, () => {});
  assert.equal(input.snapshot.decisions.length, 32);
});
test('control feedback is a bounded ordered stream, consumed separately without event replay', () => {
  const events = createControlEvents(), presented = [];
  for (let i = 0; i < 100; i++) {
    events.publish('control.changed', { soldierId: 's1', index: i }, i);
    events.drain(event => presented.push(event.index));
  }
  assert.equal(presented.length, 100);
  assert.equal(events.snapshot.history.length, 64);
  assert.equal(events.drain(() => assert.fail('event replayed')), 0);
  const event = events.publish('death.started', { soldierId: 's1', type: 'wrong', id: -1, time: -1 }, 101);
  assert.equal(event.type, 'death.started'); assert.equal(event.id, 101); assert.equal(event.time, 101);
  events.clear();
  assert.deepEqual(events.snapshot, { pending: 0, history: [] });
  assert.throws(() => events.publish('unknown', { soldierId: 's1' }, 0), RangeError);
  for (let i = 0; i < 64; i++) events.publish('death.started', { soldierId: 's1' }, i);
  assert.throws(() => events.publish('death.started', { soldierId: 's1' }, 65), /capacity/);
});
