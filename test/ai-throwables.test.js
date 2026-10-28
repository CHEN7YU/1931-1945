import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAIThrowable, planAIThrow } from '../src/ai-throwables.js';
import { throwableProfile } from '../src/grenades.js';
import { createGrenadeSystem, createGrenadeInventory, throwableVehicleDamage } from '../src/grenades.js';
import { createEntityRegistry, registerUnit, registerSoldier, registerWeapon, createVehicleEntity,
  seatSoldier, captureAttackSource, damageVehicleEntity } from '../src/entities.js';
import { CHI_HA } from '../src/chi-ha.js';

test('both teams spend their own separate stock and prioritize a nearby observed tank with a pack', () => {
  for (const team of ['friendly', 'enemy']) {
    const actor = { team, position: { x: 0, y: 0, z: 0 }, grenades: { ammo: 1, packs: 1 } };
    const person = { id: 'infantry', kind: 'person', position: { x: 0, y: 0, z: -10 } };
    const armor = { id: 'tank', kind: 'armor', position: { x: 0, y: 0, z: -13 } };
    assert.equal(chooseAIThrowable(actor, [person, armor], []).kind, 'explosive-pack');
    actor.grenades.packs = 0;
    assert.equal(chooseAIThrowable(actor, [armor], []), null, 'fragmentation is never substituted against armor');
    assert.equal(chooseAIThrowable(actor, [person], []).kind, 'grenade');
    assert.equal(chooseAIThrowable(actor, [person], [{ health: 100, position: person.position }]), null);
    assert.equal(actor.grenades.ammo, 1, 'selection does not consume stock before actual priming');
  }
});
test('throw trajectory matches actual speed, lift and gravity and rejects intermediate walls', () => {
  for (const kind of ['grenade', 'explosive-pack']) {
    const from = { x: 0, y: 1.6, z: 0 }, target = { x: 0, y: .2, z: -12 }, profile = throwableProfile(kind);
    const plan = planAIThrow(from, target, kind, () => null);
    assert.ok(plan);
    const y = from.y + (plan.direction.y * profile.speed + profile.lift) * plan.duration -
      profile.gravity * plan.duration ** 2 / 2;
    assert.ok(Math.abs(y - target.y) < 1e-6);
    assert.equal(planAIThrow(from, target, kind, () => ({ position: { x: 0, y: 1, z: -4 } })), null);
    assert.equal(planAIThrow(from, { x: 0, y: 0, z: -100 }, kind, () => null), null);
  }
});

test('both factions complete their own real timed pack throw and damage an opposite registered armored hull', () => {
  for (const team of ['friendly', 'enemy']) {
    const registry = createEntityRegistry(), targetTeam = team === 'friendly' ? 'enemy' : 'friendly';
    registerUnit(registry, { id: 'attackers', team, type: 'infantry', members: [] });
    registerUnit(registry, { id: 'armor', team: targetTeam, type: 'tank', members: [] });
    const actor = registerSoldier(registry, { id: 'thrower', unitId: 'attackers', team, health: 100,
      position: { x: 0, y: 0, z: 0 }, grenades: createGrenadeInventory() });
    actor.explosivePack = registerWeapon(registry, { get ammo() { return actor.grenades.packs; } }, 'thrower:pack', actor.id, 'explosive-pack');
    const vehicle = createVehicleEntity(registry, { id: 'hull', unitId: 'armor', team: targetTeam, type: 'tank',
      variant: targetTeam === 'enemy' ? CHI_HA.id : null, position: { x: 0, y: 0, z: -12 } });
    for (const [index, seat] of vehicle.seats.entries()) {
      const crew = registerSoldier(registry, { id: `crew-${index}`, unitId: 'armor', team: targetTeam, health: 100, position: { ...vehicle.position } });
      assert.equal(seatSoldier(registry, crew, vehicle, seat.id), null);
    }
    const choice = chooseAIThrowable(actor, [{ id: vehicle.id, kind: 'armor', position: vehicle.position }], []);
    assert.equal(choice.kind, 'explosive-pack');
    const from = { x: .32, y: 1.65, z: -.48 }, profile = throwableProfile(choice.kind);
    const plan = planAIThrow(from, { x: 0, y: profile.size, z: -12 }, choice.kind, () => null);
    const system = createGrenadeSystem(), source = captureAttackSource(registry, actor, actor.explosivePack);
    assert.equal(system.begin(actor.id, actor.grenades, source, 0, choice.kind), null);
    actor.grenades.action.aiTargetId = vehicle.id;
    assert.equal(system.release(actor.id, 0), true);
    for (let frame = 1; frame < 700; frame++) {
      const now = frame / 120;
      system.advance(now, 1 / 120, {
        pose: () => ({ position: from, direction: plan.direction }),
        trace: (a, b, radius) => {
          if (b.y >= radius) return null;
          const fraction = Math.max(0, Math.min(1, (a.y - radius) / (a.y - b.y)));
          return { position: { x: a.x + (b.x - a.x) * fraction, y: radius, z: a.z + (b.z - a.z) * fraction },
            normal: { x: 0, y: 1, z: 0 } };
        },
        explode: event => {
          const damage = throwableVehicleDamage(event.kind, event.source, vehicle, event.position, () => true);
          damageVehicleEntity(registry, vehicle, damage);
        },
      });
    }
    assert.equal(actor.grenades.packs, 0); assert.equal(actor.grenades.ammo, 1);
    assert.ok(system.history.some(event => event.type === 'throw' && event.source.weaponClass === 'explosive-pack'));
    assert.equal(system.history.find(event => event.type === 'throw').targetId, vehicle.id);
    assert.equal(system.history.find(event => event.type === 'explosion').source.soldierId, actor.id);
    assert.equal(vehicle.health, 0, 'the real timed blast, not a synthetic direct damage call, defeats the hull');
    assert.equal(system.rethrow, undefined);
  }
});
