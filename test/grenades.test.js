import test from 'node:test';
import assert from 'node:assert/strict';
import { GRENADE, EXPLOSIVE_PACK, throwableProfile, throwableStock, throwableVehicleDamage, createGrenadeInventory, createGrenadeSystem, advanceGrenadeFlight, grenadeCanDamage, grenadePose } from '../src/grenades.js';
import { createEntityRegistry, registerUnit, createVehicleEntity, damageVehicleEntity } from '../src/entities.js';

const source = (id = 'a', team = 'friendly') => ({ soldierId: id, unitId: 'squad', weaponId: `${id}:grenades`, team,
  credit: team === 'enemy' ? 'enemy' : 'player', vehicleId: null, seatId: null });
function fixture() {
  const system = createGrenadeSystem(), inventory = createGrenadeInventory(), blasts = [];
  const hooks = { pose: () => ({ position: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    trace: () => null, explode: event => blasts.push(event) };
  assert.equal(system.begin('a', inventory, source(), 0), null);
  return { system, inventory, blasts, step: (now, dt = .01) => system.advance(now, dt, hooks), hooks };
}
test('each soldier starts with one grenade and one pack; cancellation does not consume, priming consumes only the selected kind', () => {
  const { system, inventory, step } = fixture(), other = createGrenadeInventory();
  assert.equal(inventory.ammo, 1); assert.equal(inventory.packs, 1);
  step(.2); system.interrupt('a');
  assert.equal(inventory.ammo, 1); assert.equal(system.active.length, 0);
  system.begin('a', inventory, source(), .2);
  step(.7); assert.equal(inventory.ammo, 0);
  step(.8); assert.equal(inventory.ammo, 0); assert.equal(other.ammo, 1); assert.equal(inventory.packs, 1);
  assert.match(system.begin('a', inventory, source(), .8), /正在/);
});
test('slot availability checks each owned stock independently without consuming or mutating either item', () => {
  const inventory = createGrenadeInventory();
  assert.equal(throwableStock(inventory, 'grenade'), 1);
  inventory.ammo = 0;
  assert.equal(throwableStock(inventory, 'grenade'), 0);
  assert.equal(throwableStock(inventory, 'explosive-pack'), 1);
  inventory.packs = 0;
  const before = JSON.stringify(inventory);
  for (let i = 0; i < 10; i++) assert.equal(throwableStock(inventory, 'explosive-pack'), 0);
  assert.equal(JSON.stringify(inventory), before);
  assert.throws(() => throwableStock({ ammo: NaN }, 'grenade'), RangeError);
});
test('tap queues a throw after draw and windup, cooking preserves the original fuse; one explosion', () => {
  const { system, inventory, step, blasts } = fixture();
  assert.equal(system.release('a', .05), true);
  assert.equal(system.release('a', .06), false);
  step(.45); assert.equal(inventory.ammo, 0);
  step(.67); assert.equal(system.active[0].phase, 'flight');
  assert.equal(inventory.action.phase, 'recovering');
  assert.equal(system.active[0].detonateAt, GRENADE.draw + GRENADE.fuse);
  step(1.1); assert.equal(inventory.action, null);
  step(4.46); step(5);
  assert.equal(blasts.length, 1); assert.equal(system.active.length, 0);
  assert.equal(blasts[0].source.weaponId, 'a:grenades');
  assert.equal(inventory.ammo, 0);
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
  assert.equal(inventory.action, null); assert.equal(inventory.ammo, 0);
  assert.equal(system.active[0].holderId, null); assert.equal(system.active[0].detonateAt, deadline);
  system.forget('a'); step(4.46);
  assert.equal(blasts.length, 1); assert.equal(blasts[0].source.soldierId, 'a');
});
test('live grenades cannot be picked up or thrown back and always retain the original thrower', () => {
  const { system, step, inventory, blasts } = fixture();
  step(.5); system.interrupt('a');
  const grenade = system.active[0], second = createGrenadeInventory();
  assert.equal(system.rethrow, undefined, 'no hidden throwback API remains');
  assert.equal(system.begin('b', second, source('b', 'enemy'), 1), null);
  step(1.23); assert.equal(inventory.ammo, 0);
  assert.equal(grenade.detonateAt, 4.45); assert.equal(grenade.holderId, null);
  assert.equal(grenade.source.soldierId, 'a');
  step(4.46);
  assert.equal(blasts[0].source.soldierId, 'a'); assert.equal(blasts[0].originalSource.soldierId, 'a');
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
    assert.equal(blasts.length, 1); assert.equal(inventory.ammo, 0);
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
test('one grenade and one pack exhaust independently while a different soldier retains both items', () => {
  const { system, inventory, step } = fixture();
  step(.5); system.release('a', .5); step(.73); step(1.2);
  assert.match(system.begin('a', inventory, source(), 1.2), /用完/);
  assert.equal(system.begin('a', inventory, { ...source(), weaponId: 'a:explosive-pack' }, 1.2, 'explosive-pack'), null);
  step(1.81); system.release('a', 1.81); step(2.12); step(2.7);
  assert.equal(inventory.ammo, 0);
  assert.equal(inventory.packs, 0);
  assert.match(system.begin('a', inventory, source(), 2.7), /用完/);
  assert.match(system.begin('a', inventory, source(), 2.7, 'explosive-pack'), /用完/);
  assert.equal(system.begin('b', createGrenadeInventory(), source('b'), 2.7), null);
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
  assert.equal(extra.ammo, 1); assert.equal(extra.packs, 1); assert.equal(extra.action, null); assert.equal(system.active.length, GRENADE.limit);
});

test('packs have a separate fuse, lower throw speed, timed-only detonation and no throwback', () => {
  const system = createGrenadeSystem(), inventory = createGrenadeInventory(), blasts = [];
  assert.equal(system.begin('a', inventory, { ...source(), weaponId: 'a:explosive-pack' }, 0, 'explosive-pack'), null);
  system.release('a', 0);
  const hooks = { pose: () => ({ position: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    trace: () => null, explode: event => blasts.push(event) };
  system.advance(.61, .61, hooks);
  assert.equal(inventory.ammo, 1); assert.equal(inventory.packs, 0);
  const pack = system.active[0], deadline = EXPLOSIVE_PACK.draw + EXPLOSIVE_PACK.fuse;
  assert.equal(pack.detonateAt, deadline);
  system.advance(.91, .3, hooks); assert.equal(pack.phase, 'flight');
  assert.ok(Math.abs(pack.velocity.z + EXPLOSIVE_PACK.speed) < 1e-8 && EXPLOSIVE_PACK.speed < GRENADE.speed);
  assert.equal(blasts.length, 0, 'launching or collision must not detonate the pack');
  assert.equal(system.rethrow, undefined);
  system.advance(1.31, .4, hooks); assert.equal(pack.holderId, null); assert.equal(pack.detonateAt, deadline);
  system.advance(deadline + .01, deadline - 1.3, hooks);
  assert.equal(blasts.length, 1); assert.equal(blasts[0].kind, 'explosive-pack');
  assert.equal(blasts[0].source.weaponId, 'a:explosive-pack'); assert.equal(blasts[0].originalSource.weaponId, 'a:explosive-pack');
  assert.equal(grenadeCanDamage(source(), { id: 'enemy-tank', team: 'enemy', targetKind: 'closed-armor' }, 'explosive-pack'), true);
  assert.equal(grenadeCanDamage(source(), { id: 'friend-tank', team: 'friendly', targetKind: 'closed-armor' }, 'explosive-pack'), false);
  assert.throws(() => throwableProfile('sticky-remote'), RangeError);
});

test('the actual vehicle blast policy leaves tanks immune to grenades but applies nearby visible pack damage to the owned hull', () => {
  const registry = createEntityRegistry();
  registerUnit(registry, { id: 'tank-unit' });
  const tank = createVehicleEntity(registry, { id: 'tank', unitId: 'tank-unit', team: 'enemy', type: 'tank',
    position: { x: 0, y: 0, z: 0 } }), blast = { x: 1.1, y: .1, z: 0 };
  const original = tank.health;
  assert.equal(throwableVehicleDamage('grenade', source(), tank, blast, () => true), 0);
  assert.equal(tank.health, original);
  assert.equal(throwableVehicleDamage('explosive-pack', source(), tank, blast, () => false), 0, 'walls stop pack damage');
  assert.equal(throwableVehicleDamage('explosive-pack', source(), tank, { x: 10, y: .1, z: 0 }, () => true), 0);
  assert.equal(throwableVehicleDamage('explosive-pack', source(), { ...tank, team: 'friendly' }, blast, () => true), 0);
  const damage = throwableVehicleDamage('explosive-pack', source(), tank, blast, () => true);
  assert.ok(damage > 0);
  const result = damageVehicleEntity(registry, tank, damage);
  assert.equal(tank.health, Math.max(0, original - damage));
  assert.ok(result.damage > 0 && result.destroyed);
});
