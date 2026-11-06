import { shotState } from './core.js';
import { controlledSoldier, occupiedVehicle } from './entities.js';
import { advanceRifle, reloadRifle, infantryWeaponProfile, rifleReloadSeconds } from './rifle-action.js';

function requireWeapon(registry, weapon, ownerId, type) {
  if (!weapon || weapon.ownerId !== ownerId || weapon.type !== type || registry.weapons.get(weapon.id) !== weapon) throw new Error(`Broken weapon ownership: ${ownerId}`);
}

export function syncControlledRifleTiming(registry, now, stowed) {
  if (!Number.isFinite(now) || now < 0 || typeof stowed !== 'boolean') throw new RangeError('Rifle timing requires simulation time and explicit stowed state');
  const actor = controlledSoldier(registry);
  if (!actor || actor.hasFirearm === false || actor.health <= 0 || occupiedVehicle(registry, actor) || actor.groundType !== 'infantry') return false;
  requireWeapon(registry, actor.rifle, actor.id, 'infantry');
  actor.rifle.reloadUntil = !stowed && actor.rifle.action === 'reload' ? now + rifleReloadSeconds(actor.rifle) - actor.rifle.elapsed : 0;
  return true;
}

export function advanceOwnedWeapons(registry, dt, now, personalActive = false, aiActive = false) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 ||
    typeof personalActive !== 'boolean' || typeof aiActive !== 'boolean') throw new RangeError('Weapon simulation requires finite simulation time and explicit personal/AI action policies');
  const events = [];
  if (dt === 0) return events;
  for (const vehicle of registry.vehicles.values()) {
    if (vehicle.health <= 0) continue;
    requireWeapon(registry, vehicle.weapon, vehicle.id, vehicle.type);
    shotState(vehicle.weapon, now, false);
    for (const gun of vehicle.machineGuns ?? []) {
      requireWeapon(registry, gun, vehicle.id, vehicle.type);
      shotState(gun, now, false);
    }
  }
  for (const unit of registry.units.values()) {
    if (unit.type !== 'mortar') continue;
    requireWeapon(registry, unit.supportWeapon, unit.id, 'mortar');
    shotState(unit.supportWeapon, now, false);
  }
  const selected = controlledSoldier(registry);
  for (const actor of registry.soldiers.values()) {
    if (actor.hasFirearm === false) {
      if (actor.rifle?.id || actor.rifle?.ammo !== 0 || actor.rifle?.reserve !== 0)
        throw new Error(`Unarmed soldier has an active firearm: ${actor.id}`);
      continue;
    }
    const autonomous = actor !== selected && aiActive;
    const active = autonomous || actor === selected && personalActive && actor.groundType === 'infantry';
    if (!active || actor.health <= 0 || actor.vehicleId || actor.emplacementWeaponId || actor.grenades?.action) continue;
    requireWeapon(registry, actor.rifle, actor.id, 'infantry');
    if (autonomous && actor.rifle.ammo === 0) reloadRifle(actor.rifle);
    for (const cue of advanceRifle(actor.rifle, dt)) {
      if (cue !== 'ready') events.push({ unitId: actor.unitId, soldierId: actor.id, weaponId: actor.rifle.id, cue });
    }
  }
  return events;
}
