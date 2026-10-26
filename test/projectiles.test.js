import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectile, advanceProjectile } from '../src/projectiles.js';
import { createEntityRegistry, registerUnit, registerWeapon, registerSoldier, captureAttackSource, resetEntities } from '../src/entities.js';

const shot = overrides => createProjectile({ id: 'shell-1',
  source: { credit: 'player', team: 'friendly', unitId: 'alpha', soldierId: 's0', weaponId: 'alpha:mortar', vehicleId: null, seatId: null },
  start: { x: 0, y: 1, z: 0 }, target: { x: 80, y: 0, z: 0 }, duration: 4, damage: 160, radius: 13, firedAt: 10, ...overrides });

test('projectile simulation owns copied positions and original source, never a mesh or live controller', () => {
  const start = { x: 0, y: 1, z: 0 }, target = { x: 80, y: 0, z: 0 };
  const source = { credit: 'player', unitId: 'alpha', soldierId: 's0', weaponId: 'alpha:mortar' };
  const projectile = shot({ start, target, source });
  start.x = 999; target.x = 999; source.soldierId = 's1';
  assert.equal('mesh' in projectile, false);
  assert.equal(projectile.start.x, 0);
  assert.equal(projectile.target.x, 80);
  assert.equal(projectile.source.soldierId, 's0');
  const traces = [];
  advanceProjectile(projectile, 2, (from, to) => { traces.push({ from, to }); return null; });
  assert.deepEqual(traces[0].from, { x: 0, y: 1, z: 0 });
  assert.equal(projectile.position.x, 40);
  assert.ok(Math.abs(projectile.position.y - (.5 + 12 + Math.hypot(80, 1) * .22)) < 1e-10);
  assert.throws(() => { projectile.source.weaponId = 'another-weapon'; }, TypeError);
});
test('zero simulation time freezes flight; one impact retains ownership after the firing actor is gone', () => {
  const projectile = shot(), source = structuredClone(projectile.source);
  advanceProjectile(projectile, .5, () => null);
  const before = structuredClone(projectile);
  assert.equal(advanceProjectile(projectile, 0, () => assert.fail('paused flight must not trace')), null);
  assert.deepEqual(projectile, before);
  const event = advanceProjectile(projectile, 10, () => null);
  assert.deepEqual(event.source, source);
  assert.deepEqual(event.position, { x: 80, y: 0, z: 0 });
  assert.equal(event.damage, 160); assert.equal(event.radius, 13);
  assert.equal(event.time, 14); assert.equal(event.collided, false);
  assert.equal(advanceProjectile(projectile, 1, () => assert.fail('spent projectile must not trace')), null);
});
test('a real registered mortar source survives firing-member death and removal from the world registry', () => {
  const world = createEntityRegistry();
  const unit = registerUnit(world, { id: 'alpha', team: 'friendly' });
  unit.supportWeapon = registerWeapon(world, { ammo: 1 }, 'alpha:mortar', unit.id, 'mortar');
  const actor = registerSoldier(world, { id: 's0', unitId: unit.id, team: 'friendly', groundType: 'mortar', health: 100 });
  world.control.unitId = unit.id; world.control.soldierId = actor.id;
  const projectile = shot({ source: captureAttackSource(world, actor) });
  actor.health = 0;
  resetEntities(world);
  const event = advanceProjectile(projectile, 4, () => null);
  assert.equal(world.soldiers.size, 0);
  assert.equal(world.weapons.size, 0);
  assert.equal(event.source.soldierId, actor.id);
  assert.equal(event.source.weaponId, 'alpha:mortar');
  assert.equal(event.source.credit, 'player');
});
test('physical hits terminate at the real contact point and cannot emit duplicate explosions', () => {
  const projectile = shot();
  const event = advanceProjectile(projectile, .1, () => ({ x: 1, y: 2, z: 0 }));
  assert.equal(event.collided, true);
  assert.deepEqual(event.position, { x: 1, y: 2, z: 0 });
  assert.deepEqual(projectile.position, event.position);
  assert.equal(projectile.active, false);
  assert.equal(advanceProjectile(projectile, 1, () => assert.fail('duplicate collision')), null);
});
test('30/60/144Hz preserve the same arc, lifetime, damage and original source', () => {
  for (const fps of [30, 60, 144]) {
    const projectile = shot({ duration: 2.5 });
    let event = null, frames = 0;
    while (!event && frames++ < fps * 3) event = advanceProjectile(projectile, 1 / fps, () => null);
    assert.ok(event);
    assert.ok(Math.abs(frames / fps - 2.5) <= 1 / fps + 1e-10);
    assert.equal(event.time, 12.5);
    assert.equal(event.source.soldierId, 's0');
    assert.equal(event.damage, 160);
    assert.deepEqual(event.position, { x: 80, y: 0, z: 0 });
  }
});
test('invalid flight input is explicit, and trace failures are not swallowed', () => {
  for (const overrides of [{ duration: 0 }, { radius: -1 }, { damage: NaN }, { firedAt: -1 },
    { target: { x: Infinity, y: 0, z: 0 } }, { source: { soldierId: 's0' } }]) assert.throws(() => shot(overrides));
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceProjectile(shot(), dt, () => null), RangeError);
  assert.throws(() => advanceProjectile(shot(), .1, () => { throw new Error('physical trace failed'); }), /physical trace failed/);
  assert.throws(() => advanceProjectile(shot(), .1, () => ({ x: NaN, y: 0, z: 0 })), /positions must be finite/);
});
