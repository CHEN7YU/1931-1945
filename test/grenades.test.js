import test from 'node:test';
import assert from 'node:assert/strict';
import { GRENADE, createGrenadeInventory, createGrenadeSystem, advanceGrenadeFlight, grenadeCanDamage, grenadePose } from '../src/grenades.js';

const source = (id = 'a', team = 'friendly') => ({ soldierId: id, unitId: 'squad', weaponId: `${id}:grenades`, team,
  credit: team === 'enemy' ? 'enemy' : 'player', vehicleId: null, seatId: null });
function fixture() {
  const system = createGrenadeSystem(), inventory = createGrenadeInventory(), blasts = [];
  const hooks = { pose: () => ({ position: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    trace: () => null, explode: event => blasts.push(event) };
  assert.equal(system.begin('a', inventory, source(), 0), null);
  return { system, inventory, blasts, step: (now, dt = .01) => system.advance(now, dt, hooks), hooks };
}
test('each soldier starts with two grenades; drawing cancellation does not consume, priming consumes once', () => {
  const { system, inventory, step } = fixture(), other = createGrenadeInventory();
  assert.equal(inventory.ammo, 2);
  step(.2); system.interrupt('a');
  assert.equal(inventory.ammo, 2); assert.equal(system.active.length, 0);
  system.begin('a', inventory, source(), .2);
  step(.7); assert.equal(inventory.ammo, 1);
  step(.8); assert.equal(inventory.ammo, 1); assert.equal(other.ammo, 2);
  assert.match(system.begin('a', inventory, source(), .8), /正在/);
});
test('tap queues a throw after draw and windup, cooking preserves the original fuse; one explosion', () => {
  const { system, inventory, step, blasts } = fixture();
  assert.equal(system.release('a', .05), true);
  assert.equal(system.release('a', .06), false);
  step(.45); assert.equal(inventory.ammo, 1);
  step(.67); assert.equal(system.active[0].phase, 'flight');
  assert.equal(inventory.action.phase, 'recovering');
  assert.equal(system.active[0].detonateAt, GRENADE.draw + GRENADE.fuse);
  step(1.1); assert.equal(inventory.action, null);
  step(4.46); step(5);
  assert.equal(blasts.length, 1); assert.equal(system.active.length, 0);
  assert.equal(blasts[0].source.weaponId, 'a:grenades');
  assert.equal(inventory.ammo, 1);
});
test('holding cooks instead of charging power and auto-releases before the fuse expires', () => {
  const { system, step } = fixture();
  step(.5); assert.equal(system.active[0].phase, 'cooking');
  step(3); assert.equal(system.active[0].phase, 'cooking');
  step(3.81); assert.equal(system.active[0].phase, 'flight');
  assert.equal(system.active[0].detonateAt, 4.45);
  assert.ok(Math.abs(system.active[0].velocity.z + GRENADE.speed) < 1e-9);
});
test('death or changing member drops a live grenade without refunding or changing its credit', () => {
  const { system, inventory, step, blasts } = fixture();
  step(.5); const deadline = system.active[0].detonateAt;
  system.interrupt('a');
  assert.equal(inventory.action, null); assert.equal(inventory.ammo, 1);
  assert.equal(system.active[0].holderId, null); assert.equal(system.active[0].detonateAt, deadline);
  system.forget('a'); step(4.46);
  assert.equal(blasts.length, 1); assert.equal(blasts[0].source.soldierId, 'a');
});
test('throwback uses no personal grenade, changes credit, and never resets the fuse', () => {
  const { system, step, inventory, blasts } = fixture();
  step(.5); system.interrupt('a');
  const grenade = system.active[0], second = createGrenadeInventory();
  second.ammo = 0;
  assert.equal(system.rethrow(grenade.id, 'b', second, source('b', 'enemy'), 1), null);
  step(1.23); assert.equal(second.ammo, 0); assert.equal(inventory.ammo, 1);
  assert.equal(grenade.detonateAt, 4.45); assert.equal(grenade.throws, 1);
  step(4.46);
  assert.equal(blasts[0].source.soldierId, 'b'); assert.equal(blasts[0].originalSource.soldierId, 'a');
});
test('too-late throwback detonates in the new holder hand and cannot duplicate the grenade', () => {
  const { system, step, blasts } = fixture();
  step(.5); system.interrupt('a');
  const grenade = system.active[0], second = createGrenadeInventory();
  system.rethrow(grenade.id, 'b', second, source('b'), 4.4);
  assert.match(system.rethrow(grenade.id, 'c', createGrenadeInventory(), source('c'), 4.41), /无法/);
  step(4.46); assert.equal(blasts.length, 1); assert.equal(second.ammo, 2);
  assert.equal(blasts[0].source.soldierId, 'b');
});
test('continuous collision bounces rather than detonating, and ground motion settles', () => {
  const grenade = { position: { x: 0, y: .1, z: 0 }, velocity: { x: 2, y: -3, z: 0 }, collisions: 0 };
  const ground = (from, to, radius) => to.y < radius ? {
    position: { x: to.x, y: radius, z: to.z }, normal: { x: 0, y: 1, z: 0 },
  } : null;
  advanceGrenadeFlight(grenade, .1, ground);
  assert.ok(grenade.collisions > 0); assert.ok(grenade.position.y >= GRENADE.size);
  advanceGrenadeFlight(grenade, 3, ground);
  assert.deepEqual(grenade.velocity, { x: 0, y: 0, z: 0 });
  const wall = { position: { x: 0, y: 1, z: 0 }, velocity: { x: 40, y: 0, z: 0 }, collisions: 0 };
  advanceGrenadeFlight(wall, .05, (from, to) => from.x <= .1 && to.x >= .1
    ? { position: { x: .1, y: to.y, z: 0 }, normal: { x: -1, y: 0, z: 0 } } : null);
  assert.equal(wall.collisions, 1); assert.ok(wall.velocity.x < 0); assert.ok(wall.position.x < .1);
});
test('30/60/144Hz preserve flight, fuse deadline, inventory and event counts', () => {
  const results = [30, 60, 144].map(fps => {
    const { system, inventory, hooks, blasts } = fixture();
    system.release('a', 0);
    for (let i = 1; i <= Math.ceil(5 * fps); i++) system.advance(i / fps, 1 / fps, hooks);
    assert.equal(blasts.length, 1); assert.equal(inventory.ammo, 1);
    assert.equal(blasts[0].time, 4.45); return blasts[0].position;
  });
  for (const result of results) {
    assert.ok(Math.abs(result.z + GRENADE.speed * (4.45 - .67)) < 1e-6);
    assert.ok(Math.abs(result.y - results[0].y) < 1e-6);
  }
});
test('zero simulation time freezes the held fuse; clearing removes all old grenades and actions', () => {
  const { system, inventory, step } = fixture();
  step(.5);
  const before = JSON.stringify(system.active);
  system.advance(.5, 0, { pose: () => ({ position: { x: 0, y: 1.5, z: 0 } }), trace: () => null, explode: assert.fail });
  assert.equal(JSON.stringify(system.active), before);
  system.clear(); assert.deepEqual(system.active, []); assert.deepEqual(system.history, []); assert.equal(inventory.action, null);
});
test('fragmentation allows self damage and hostile infantry, not friendly soldiers or closed armor', () => {
  for (const [id, team, targetKind, expected] of [['a', 'friendly', 'person', true],
    ['b', 'friendly', 'person', false], ['c', 'enemy', 'person', true],
    ['d', 'enemy', 'closed-armor', false], ['e', 'enemy', 'aircraft', false]]) {
    assert.equal(grenadeCanDamage(source(), { id, team, targetKind }), expected);
  }
});
test('invalid inputs fail explicitly and hand projection supports stance height', () => {
  assert.throws(() => advanceGrenadeFlight({}, NaN, () => null), RangeError);
  const { system } = fixture();
  assert.throws(() => system.begin('b', { ammo: -1 }, source('b'), 0));
  assert.throws(() => system.release('a', -1), RangeError);
  assert.throws(() => system.begin('b', createGrenadeInventory(), source('a'), 0));
  assert.equal(grenadePose(null), null);
  assert.ok(grenadePose({ phase: 'cooking', elapsed: 1 }, .45).hand[1] < .45);
});
test('two actual throws exhaust the soldier, while a different soldier retains both grenades', () => {
  const { system, inventory, step } = fixture();
  step(.5); system.release('a', .5); step(.73); step(1.2);
  assert.equal(system.begin('a', inventory, source(), 1.2), null);
  step(1.66); system.release('a', 1.66); step(1.89); step(2.4);
  assert.equal(inventory.ammo, 0);
  assert.match(system.begin('a', inventory, source(), 2.4), /用完/);
  assert.equal(system.begin('b', createGrenadeInventory(), source('b'), 2.4), null);
  assert.equal(system.active.length, 3);
});
test('active grenade cap rejects before spending inventory, never deletes existing live grenades', () => {
  const system = createGrenadeSystem();
  for (let i = 0; i < GRENADE.limit; i++) {
    const id = `soldier-${i}`;
    assert.equal(system.begin(id, createGrenadeInventory(), source(id), 0), null);
  }
  const extra = createGrenadeInventory();
  assert.match(system.begin('extra', extra, source('extra'), 0), /上限/);
  assert.equal(extra.ammo, 2); assert.equal(extra.action, null); assert.equal(system.active.length, GRENADE.limit);
});
