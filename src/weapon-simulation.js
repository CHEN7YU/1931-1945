import { shotState } from './core.js';
import { controlledSoldier } from './entities.js';
import { advanceRifle } from './rifle-action.js';

function requireWeapon(registry, weapon, ownerId, type) {
  if (!weapon || weapon.ownerId !== ownerId || weapon.type !== type || registry.weapons.get(weapon.id) !== weapon) throw new Error(`Broken weapon ownership: ${ownerId}`);
}

export function advanceOwnedWeapons(registry, dt, now, personalActive = false) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 ||
    typeof personalActive !== 'boolean') throw new RangeError('Weapon simulation requires finite simulation time and an explicit personal-action policy');
  const events = [];
  if (dt === 0) return events;
  for (const vehicle of registry.vehicles.values()) {
    if (vehicle.health <= 0) continue;
    requireWeapon(registry, vehicle.weapon, vehicle.id, vehicle.type);
    shotState(vehicle.weapon, now, false);
  }
  for (const unit of registry.units.values()) {
    if (unit.type !== 'mortar') continue;
    requireWeapon(registry, unit.supportWeapon, unit.id, 'mortar');
    shotState(unit.supportWeapon, now, false);
  }
  const actor = controlledSoldier(registry);
  if (personalActive && actor?.health > 0 && !actor.vehicleId && actor.groundType === 'infantry') {
    requireWeapon(registry, actor.rifle, actor.id, 'infantry');
    for (const cue of advanceRifle(actor.rifle, dt)) {
      if (cue !== 'ready') events.push({ unitId: actor.unitId, soldierId: actor.id, weaponId: actor.rifle.id, cue });
    }
  }
  return events;
}
