import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityRegistry, registerUnit, registerSoldier, registerWeapon, createVehicleEntity, seatSoldier, releaseSeat,
  selectControlledSoldier, releaseSupportWeapon } from '../src/entities.js';
import { createRifleState, shootRifle, reloadRifle, advanceRifle, RIFLE } from '../src/rifle-action.js';
import { advanceOwnedWeapons, syncControlledRifleTiming } from '../src/weapon-simulation.js';
import { TYPES } from '../src/core.js';

function fixture() {
  const registry = createEntityRegistry();
  const unit = registerUnit(registry, { id: 'crew', type: 'tank', team: 'friendly' });
  const support = registerUnit(registry, { id: 'support', type: 'mortar', team: 'friendly' });
  const air = registerUnit(registry, { id: 'air', type: 'plane', team: 'friendly' });
  support.supportWeapon = registerWeapon(registry, { ammo: 0, reloadUntil: .3, nextShot: 0 }, 'support:mortar', support.id, 'mortar');
  const actors = [0, 1].map(index => {
    const actor = registerSoldier(registry, { id: `s${index}`, unitId: unit.id, team: 'friendly',
      groundType: 'infantry', health: 100, position: { x: 4, y: 0, z: 0 }, rifle: createRifleState() });
    registerWeapon(registry, actor.rifle, `${actor.id}:rifle`, actor.id, 'infantry');
    shootRifle(actor.rifle);
    return actor;
  });
  const tank = createVehicleEntity(registry, { id: 'tank', unitId: unit.id, type: 'tank', team: 'friendly', position: { x: 0, y: 0, z: 0 } });
  const plane = createVehicleEntity(registry, { id: 'plane', unitId: air.id, type: 'plane', team: 'friendly', position: { x: 0, y: 30, z: 0 } });
  registry.control.unitId = unit.id; selectControlledSoldier(registry, actors[0]);
  return { registry, actors, support, tank, plane };
}

test('only the selected equipped personal rifle advances; cues identify its actual soldier and weapon', () => {
  const { registry, actors } = fixture();
  assert.deepEqual(advanceOwnedWeapons(registry, .15, .15, true), [
    { unitId: 'crew', soldierId: 's0', weaponId: 's0:rifle', cue: 'unlock' },
  ]);
  assert.equal(actors[0].rifle.elapsed, .15);
  assert.equal(actors[1].rifle.elapsed, 0);
  assert.deepEqual(advanceOwnedWeapons(registry, .01, .16, true), [], 'cues are not replayed');
});
test('switching and stowing pause the original action, then resume without resetting or refilling it', () => {
  const { registry, actors } = fixture();
  reloadRifle(actors[0].rifle);
  advanceOwnedWeapons(registry, .2, .2, true);
  selectControlledSoldier(registry, actors[1]);
  advanceOwnedWeapons(registry, .2, .4, true);
  assert.equal(actors[0].rifle.elapsed, .2);
  assert.equal(actors[1].rifle.elapsed, .2);
  selectControlledSoldier(registry, actors[0]);
  assert.deepEqual(advanceOwnedWeapons(registry, 1, 1.4, false), []);
  assert.equal(actors[0].rifle.elapsed, .2);
  assert.equal(actors[0].rifle.ammo, 4);
  assert.equal(actors[0].rifle.queuedReload, true);
  assert.deepEqual(advanceOwnedWeapons(registry, .12, 1.52, true).map(event => event.cue), ['extract']);
  assert.equal(actors[0].rifle.elapsed, .32);
});
test('vehicle and unit support reloads use simulation time independently of the selected rifle', () => {
  const { registry, actors, support, tank, plane } = fixture();
  tank.weapon.ammo = 0; tank.weapon.reloadUntil = .2;
  plane.weapon.ammo = 2; plane.weapon.reloadUntil = .25;
  assert.deepEqual(advanceOwnedWeapons(registry, .5, .5, false), []);
  assert.equal(tank.weapon.ammo, TYPES.tank.magazine);
  assert.equal(plane.weapon.ammo, TYPES.plane.magazine);
  assert.equal(support.supportWeapon.ammo, TYPES.mortar.magazine);
  assert.equal(tank.weapon.reloadUntil, 0);
  assert.equal(actors[0].rifle.elapsed, 0);
  tank.weapon.ammo = 0;
  advanceOwnedWeapons(registry, .5, 1, false);
  assert.equal(tank.weapon.reloadUntil, 0, 'an empty background weapon does not auto-start another reload');
});
test('zero simulation time freezes all weapons and seated/dead members cannot advance personal actions', () => {
  const { registry, actors, support, tank } = fixture();
  tank.weapon.ammo = 0; tank.weapon.reloadUntil = .2;
  const before = structuredClone([...registry.weapons.values()]);
  assert.deepEqual(advanceOwnedWeapons(registry, 0, .5, true), []);
  assert.deepEqual([...registry.weapons.values()], before);
  assert.equal(seatSoldier(registry, actors[0], tank, tank.seats[0].id), null);
  assert.deepEqual(advanceOwnedWeapons(registry, .15, .15, true), []);
  assert.equal(actors[0].rifle.elapsed, 0);
  releaseSeat(registry, actors[0]);
  actors[0].health = 0; tank.health = 0;
  advanceOwnedWeapons(registry, .5, .65, true);
  assert.equal(actors[0].rifle.elapsed, 0);
  assert.equal(tank.weapon.ammo, 0);
  assert.equal(support.supportWeapon.ammo, 1);
});
test('30/60/144Hz retain queued reload timing and emit each mechanical cue once', () => {
  for (const fps of [30, 60, 144]) {
    const { registry, actors } = fixture(), cues = [];
    reloadRifle(actors[0].rifle);
    for (let frame = 1; frame <= 4 * fps; frame++) cues.push(...advanceOwnedWeapons(registry, 1 / fps, frame / fps, true).map(event => event.cue));
    assert.deepEqual(cues, ['unlock', 'extract', 'close', 'unlock', 'extract', 'load', 'close']);
    assert.equal(actors[0].rifle.ammo, 5);
    assert.equal(actors[0].rifle.action, 'idle');
    assert.equal(actors[1].rifle.elapsed, 0);
  }
});
test('replacing unit support weapons does not leak registrations or dispose a different owner resource', () => {
  const { registry, support, actors } = fixture();
  const size = registry.weapons.size;
  for (let generation = 1; generation <= 100; generation++) {
    const retiredId = support.supportWeapon.id;
    releaseSupportWeapon(registry, support);
    assert.equal(registry.weapons.has(retiredId), false);
    support.supportWeapon = registerWeapon(registry, { ammo: 1, reloadUntil: 0, nextShot: 0 }, `support:mortar-${generation}`, support.id, 'mortar');
    assert.equal(registry.weapons.size, size);
  }
  releaseSupportWeapon(registry, support);
  releaseSupportWeapon(registry, support);
  support.type = 'infantry';
  assert.equal(registry.weapons.size, size - 1);
  advanceOwnedWeapons(registry, .1, .1);
  support.supportWeapon = actors[0].rifle;
  assert.throws(() => releaseSupportWeapon(registry, support), /ownership/);
  assert.equal(registry.weapons.get(actors[0].rifle.id), actors[0].rifle);
});
test('invalid time, policy and broken weapon ownership fail explicitly', () => {
  const { registry, support, actors } = fixture();
  for (const [dt, now, active] of [[-1, 0, true], [NaN, 0, false], [.1, Infinity, true], [.1, -1, true], [.1, 1, 'yes']]) {
    assert.throws(() => advanceOwnedWeapons(registry, dt, now, active), RangeError);
  }
  registry.weapons.delete(support.supportWeapon.id);
  assert.throws(() => advanceOwnedWeapons(registry, .1, 1), /ownership/);
  registry.weapons.set(support.supportWeapon.id, support.supportWeapon);
  registry.weapons.delete(actors[0].rifle.id);
  assert.throws(() => advanceOwnedWeapons(registry, .1, 1, true), /ownership/);
});
test('incoming personal reload timing is ready before presentation, without advancing action or refilling ammo', () => {
  const { registry, actors, tank } = fixture();
  reloadRifle(actors[1].rifle);
  advanceRifle(actors[1].rifle, 1.65);
  selectControlledSoldier(registry, actors[1]);
  const before = { action: actors[1].rifle.action, elapsed: actors[1].rifle.elapsed, ammo: actors[1].rifle.ammo };
  assert.equal(before.action, 'reload');
  assert.equal(syncControlledRifleTiming(registry, 5, false), true);
  assert.ok(Math.abs(actors[1].rifle.reloadUntil - (5 + RIFLE.reloadSeconds - before.elapsed)) < 1e-10);
  syncControlledRifleTiming(registry, 6, true);
  assert.equal(actors[1].rifle.reloadUntil, 0);
  syncControlledRifleTiming(registry, 7, false);
  assert.deepEqual({ action: actors[1].rifle.action, elapsed: actors[1].rifle.elapsed, ammo: actors[1].rifle.ammo }, before);
  assert.equal(seatSoldier(registry, actors[1], tank, tank.seats[1].id), null);
  tank.weapon.reloadUntil = 9;
  const personal = structuredClone(actors[1].rifle);
  assert.equal(syncControlledRifleTiming(registry, 8, false), false);
  assert.deepEqual(actors[1].rifle, personal);
  assert.equal(tank.weapon.reloadUntil, 9);
  assert.throws(() => syncControlledRifleTiming(registry, -1, false), RangeError);
  assert.throws(() => syncControlledRifleTiming(registry, 8, 'yes'), RangeError);
});

test('explicit AI policy advances both factions, not a stowed selected rifle, and retains cue identity', () => {
  const { registry, actors } = fixture();
  const unit = registerUnit(registry, { id: 'enemy-unit', type: 'infantry', team: 'enemy' });
  const enemy = registerSoldier(registry, { id: 'enemy', unitId: unit.id, team: 'enemy', groundType: 'infantry',
    health: 100, rifle: createRifleState() });
  registerWeapon(registry, enemy.rifle, 'enemy:rifle', enemy.id, 'infantry');
  shootRifle(enemy.rifle);
  const events = advanceOwnedWeapons(registry, .15, .15, false, true);
  assert.equal(actors[0].rifle.elapsed, 0);
  assert.equal(actors[1].rifle.elapsed, .15);
  assert.equal(enemy.rifle.elapsed, .15);
  assert.deepEqual(events.map(event => [event.soldierId, event.weaponId, event.cue]),
    [['s1', 's1:rifle', 'unlock'], ['enemy', 'enemy:rifle', 'unlock']]);
  const before = structuredClone([...registry.weapons.values()]);
  assert.deepEqual(advanceOwnedWeapons(registry, 0, 100, true, true), []);
  assert.deepEqual([...registry.weapons.values()], before);
});

test('autonomous empty rifles load on their own action clock; Y neither refills nor restarts it', () => {
  const { registry, actors } = fixture();
  actors[1].rifle.ammo = 0;
  advanceOwnedWeapons(registry, .65, .65, false, true);
  assert.equal(actors[1].rifle.action, 'reload');
  assert.equal(actors[1].rifle.ammo, 0);
  advanceOwnedWeapons(registry, 1, 1.65, false, true);
  const before = structuredClone(actors[1].rifle);
  selectControlledSoldier(registry, actors[1]);
  assert.deepEqual(actors[1].rifle, before);
  advanceOwnedWeapons(registry, .1, 1.75, true, true);
  assert.ok(Math.abs(actors[1].rifle.elapsed - 1.1) < 1e-9);
  assert.equal(actors[1].rifle.ammo, 0);
  selectControlledSoldier(registry, actors[0]);
  advanceOwnedWeapons(registry, 1.59, 3.34, false, true);
  assert.equal(actors[1].rifle.ammo, 0);
  advanceOwnedWeapons(registry, .02, 3.36, false, true);
  assert.equal(actors[1].rifle.ammo, 5);
});

test('AI policy still rejects broken ownership and does not advance dead or seated personal rifles', () => {
  const { registry, actors, tank } = fixture();
  assert.equal(seatSoldier(registry, actors[1], tank, tank.seats[0].id), null);
  advanceOwnedWeapons(registry, .2, .2, false, true);
  assert.equal(actors[1].rifle.elapsed, 0);
  releaseSeat(registry, actors[1]);
  actors[1].health = 0;
  advanceOwnedWeapons(registry, .2, .4, false, true);
  assert.equal(actors[1].rifle.elapsed, 0);
  actors[1].health = 100;
  registry.weapons.delete(actors[1].rifle.id);
  assert.throws(() => advanceOwnedWeapons(registry, .1, .5, false, true), /ownership/);
  assert.throws(() => advanceOwnedWeapons(registry, .1, .5, false, 'yes'), RangeError);
});
