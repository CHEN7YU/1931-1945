import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlInput } from '../src/control-input.js';
import { createControlEvents } from '../src/control-events.js';
import { createSimulationClock } from '../src/simulation-clock.js';

const owner = (soldierId = 's1', vehicleId = null) => ({ unitId: 'u1', soldierId, vehicleId,
  seatId: vehicleId ? `${vehicleId}:seat-0` : null, weaponId: vehicleId ? `${vehicleId}:primary` : `${soldierId}:rifle` });
test('down/up before a real simulation step preserves exactly one fire attempt, not a delayed held button', () => {
  const input = createControlInput(), source = owner(), clock = createSimulationClock();
  input.bind(source); clock.setActive(true, 0);
  input.execute(input.capture('pressFire'), source, true, () => input.pressFire());
  input.releaseFire();
  assert.equal(input.held.primary, false);
  assert.equal(input.snapshot.pendingFire, true);
  assert.equal(clock.takeStep(), 0, 'input does not itself advance the clock or attempt a shot');
  clock.beginFrame(1000);
  let attempts = 0;
  for (let dt; (dt = clock.takeStep()) > 0;) if (input.consumeFire(source, true)) attempts++;
  assert.equal(attempts, 1, 'catch-up steps do not replay the click');
  assert.equal(input.snapshot.pendingFire, false);
  assert.equal(input.held.primary, false);
});
test('released clicks rejected by a fire gate never retry when that gate becomes eligible later', () => {
  const input = createControlInput(), source = owner();
  input.bind(source); input.pressFire(); input.releaseFire();
  let eligible = false, attempts = 0, shots = 0;
  const step = () => {
    if (!input.consumeFire(source, true)) return;
    attempts++;
    if (eligible) shots++;
  };
  step();
  eligible = true;
  for (let i = 0; i < 20; i++) step();
  assert.equal(attempts, 1);
  assert.equal(shots, 0, 'cooldown/ammo/other gates cannot resurrect a drained click');
});
test('holding retains existing per-step fire requests and multiple pre-step clicks are bounded to one intent', () => {
  const input = createControlInput(), source = owner();
  input.bind(source); input.pressFire();
  for (let step = 0; step < 10; step++) assert.equal(input.consumeFire(source, true), true);
  input.releaseFire();
  assert.equal(input.consumeFire(source, true), false, 'the press was already consumed while held');
  for (let click = 0; click < 10000; click++) { input.pressFire(); input.releaseFire(); }
  assert.equal(input.consumeFire(source, true), true);
  assert.equal(input.consumeFire(source, true), false);
  assert.equal(input.snapshot.pendingFire, false);
});
test('pause, death, menu, reset, scoreboard clearing and equipment changes erase unconsumed fire presses', () => {
  for (const clear of [
    input => input.block(), input => input.bind(owner(), false), input => input.reset(),
    input => input.clearHeld(), input => input.clearFire(),
  ]) {
    const input = createControlInput(), source = owner();
    input.bind(source); input.pressFire(); input.releaseFire(); clear(input);
    assert.equal(input.snapshot.pendingFire, false);
    assert.equal(input.consumeFire(source, false), false);
    input.bind(source);
    assert.equal(input.consumeFire(source, true), false);
  }
});
test('fire intents cannot cross soldier, weapon, vehicle or seat ownership, even if the old owner returns', () => {
  const source = owner('s1', 'v1');
  for (const next of [owner('s2', 'v1'), owner('s1'), { ...source, weaponId: 'other-gun' },
    { ...source, seatId: 'v1:seat-1' }]) {
    const input = createControlInput();
    input.bind(source); input.pressFire(); input.releaseFire();
    input.bind(next);
    assert.equal(input.consumeFire(next, true), false);
    input.bind(source);
    assert.equal(input.consumeFire(source, true), false);
    input.pressFire(); input.releaseFire();
    assert.equal(input.consumeFire(next, true), false, 'a stale current-owner check drains rather than queues');
    assert.equal(input.consumeFire(source, true), false);
  }
});
test('immediate grenade/dadao commands do not automatically register a second simulation fire intent', () => {
  const input = createControlInput(), source = owner();
  input.bind(source);
  let immediate = 0;
  for (const action of ['prepareGrenade', 'pressFire']) {
    input.execute(input.capture(action), source, true, () => immediate++);
    input.releaseFire();
    assert.equal(input.consumeFire(source, true), false);
  }
  assert.equal(immediate, 2);
  const command = input.capture('pressFire');
  input.block();
  input.execute(command, source, true, () => input.pressFire());
  assert.equal(input.snapshot.pendingFire, false, 'rejected control commands never latch');
});
test('immediate commands are owned by the actual soldier and cannot be applied twice', () => {
  const input = createControlInput(), source = owner();
  input.bind(source);
  const command = input.capture('reload');
  let reloads = 0;
  assert.equal(input.execute(command, source, true, () => reloads++).status, 'applied');
  assert.equal(input.execute(command, source, true, () => reloads++).reason, 'duplicate');
  assert.equal(reloads, 1);
});
test('binding reports real ownership changes separately from pause/resume input invalidation', () => {
  const input = createControlInput(), foot = { unitId: 'u1', soldierId: 's1', weaponId: 's1:rifle' };
  assert.equal(input.bind(foot), true);
  const command = input.capture('reload'), revision = input.snapshot.revision;
  input.block();
  assert.equal(input.bind({ ...foot, vehicleId: null, seatId: null }), false, 'normalised missing/null fields are the same physical owner');
  assert.ok(input.snapshot.revision > revision);
  assert.equal(input.execute(command, owner(), true, () => assert.fail('pre-pause input replayed')).reason, 'stale-owner');
  assert.equal(input.bind(owner('s1', 'tank')), true);
  assert.equal(input.bind({ ...owner('s1', 'tank'), seatId: 'tank:seat-1' }), true);
  assert.equal(input.bind(owner('s1')), true);
  assert.equal(input.bind(owner('s2')), true);
  input.reset();
  assert.equal(input.bind(owner('s2')), true, 'a new session must reinitialise even if its IDs happen to match');
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
test('grenade press and release are one-shot owned commands invalidated by switching or pausing', () => {
  const input = createControlInput(), first = owner();
  input.bind(first);
  const press = input.capture('prepareGrenade'), release = input.capture('releaseGrenade');
  let prepares = 0;
  assert.equal(input.execute(press, first, true, () => prepares++).status, 'applied');
  assert.equal(input.execute(press, first, true, assert.fail).reason, 'duplicate');
  input.bind(owner('s2'));
  assert.equal(input.execute(release, owner('s2'), true, assert.fail).reason, 'stale-owner');
  const next = input.capture('prepareGrenade');
  input.block();
  assert.equal(input.execute(next, owner('s2'), false, assert.fail).reason, 'inactive');
  assert.equal(prepares, 1);
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
  assert.throws(() => events.publish('weapon.mechanical', { soldierId: 's1', cue: 'load' }, 0), /weapon identity/);
  assert.throws(() => events.publish('weapon.mechanical', { soldierId: 's1', weaponId: 'w1', cue: 'wrong' }, 0), /valid cue/);
  events.publish('weapon.mechanical', { soldierId: 's1', weaponId: 'w1', cue: 'load' }, 0);
  assert.equal(events.drain(event => assert.equal(event.weaponId, 'w1')), 1);
  for (let i = 0; i < 64; i++) events.publish('death.started', { soldierId: 's1' }, i);
  assert.throws(() => events.publish('death.started', { soldierId: 's1' }, 65), /capacity/);
});
test('footstep feedback captures actual owner, ground and stance rather than future controller state', () => {
  const events = createControlEvents();
  const data = { unitId: 'alpha', soldierId: 's1', position: { x: 1, y: .45, z: -16 },
    surface: 'stone', stance: 'prone', speed: .75, landing: false, model: { mutable: true } };
  const event = events.publish('movement.footstep', data, 1);
  data.position.x = 999; data.surface = 'earth'; data.stance = 'standing'; data.soldierId = 's2';
  assert.equal(event.soldierId, 's1');
  assert.equal(event.position.x, 1);
  assert.equal(event.surface, 'stone');
  assert.equal(event.stance, 'prone');
  assert.equal('model' in event, false);
  assert.throws(() => { event.position.y = 0; }, TypeError);
  const rendered = [];
  assert.equal(events.drain(value => rendered.push(value)), 1);
  assert.deepEqual(rendered[0], event);
  assert.equal(events.drain(() => assert.fail('step replayed')), 0);
  const fresh = { ...data, position: { x: 0, y: 0, z: 0 } };
  for (const surface of ['stone', 'wood', 'earth']) assert.equal(events.publish('movement.footstep', { ...fresh, surface }, 1).surface, surface);
  for (const invalid of [{ speed: NaN }, { speed: -1 }, { surface: 'unknown' }, { stance: 'unknown' },
    { unitId: '' }, { landing: 'yes' }, { position: { x: 0, y: Infinity, z: 0 } }]) {
    assert.throws(() => events.publish('movement.footstep', { ...fresh, ...invalid }, 1));
  }
});
test('door requests have their own world identity, not the current player identity or a live door reference', () => {
  const events = createControlEvents();
  const door = { id: 'west-door', position: { x: -4.5, y: 1.2, z: 64 }, targetAngle: 1.5 };
  const event = events.publish('door.requested', { doorId: door.id, position: door.position, opening: true,
    soldierId: 'wrong-player', door }, 2);
  door.position.x = 100; door.targetAngle = 0;
  assert.equal(event.doorId, 'west-door');
  assert.equal(event.position.x, -4.5);
  assert.equal(event.opening, true);
  assert.equal('soldierId' in event, false);
  assert.equal('door' in event, false);
  assert.throws(() => events.publish('door.requested', { doorId: '', position: event.position, opening: true }, 2));
  assert.throws(() => events.publish('door.requested', { doorId: 'door', position: event.position }, 2));
  events.clear();
  assert.deepEqual(events.snapshot.history, []);
  assert.equal(events.drain(() => assert.fail('old door replayed')), 0);
});
test('construction completion feedback retains the builder and registered rally without live model references', () => {
  const events = createControlEvents(), position = { x: 0, y: .45, z: 73 };
  const event = events.publish('construction.notice', { unitId: 'alpha', soldierId: 'engineer-1',
    reason: 'completed', rallyId: 'friendly-rally-1', position, model: {} }, 6);
  position.x = 999;
  assert.equal(event.position.x, 0);
  assert.equal(event.rallyId, 'friendly-rally-1');
  assert.equal(event.soldierId, 'engineer-1');
  assert.equal('model' in event, false);
  assert.throws(() => { event.position.y = 0; }, TypeError);
  assert.throws(() => events.publish('construction.notice', { unitId: 'alpha', soldierId: 's1', reason: 'completed', position }, 6), /construction feedback/);
  assert.throws(() => events.publish('construction.notice', { unitId: 'alpha', soldierId: 's1', reason: 'unknown' }, 6), /construction feedback/);
});
test('rally loss is a world notification without a fake current-player owner', () => {
  const events = createControlEvents(), point = { x: 0, y: .45, z: 73 };
  const event = events.publish('rally.destroyed', { rallyId: 'friendly-rally', builderId: 'original-engineer', team: 'friendly',
    position: point, soldierId: 'wrong-current-player', model: {} }, 8);
  point.x = 999;
  assert.equal(event.position.x, 0);
  assert.equal(event.builderId, 'original-engineer');
  assert.equal('soldierId' in event, false);
  assert.equal('model' in event, false);
  assert.throws(() => events.publish('rally.destroyed', { ...event, team: 'missing' }, 8), /world identity/);
  events.clear();
  assert.equal(events.drain(() => assert.fail('old rally loss replayed')), 0);
});
