import { TYPES } from './core.js';

const copyPosition = position => position.clone ? position.clone() : { ...position };
export const TANK_SEATS = Object.freeze([
  Object.freeze({ role: 'commander', label: '车长', eyeHeight: 2.7, canFire: true }),
  Object.freeze({ role: 'gunner', label: '炮手', eyeHeight: 1.9, canFire: true }),
  Object.freeze({ role: 'driver', label: '驾驶员', eyeHeight: 1.3, canFire: false }),
]);

export function createEntityRegistry() {
  return { units: new Map(), soldiers: new Map(), weapons: new Map(), vehicles: new Map(),
    control: { unitId: null, soldierId: null } };
}

export function registerUnit(registry, unit) {
  if (!unit.id || registry.units.has(unit.id)) throw new Error(`Duplicate or missing unit ID: ${unit.id}`);
  registry.units.set(unit.id, unit);
  return unit;
}

export function registerWeapon(registry, weapon, id, ownerId, type) {
  if (registry.weapons.has(id)) throw new Error(`Duplicate weapon ID: ${id}`);
  Object.assign(weapon, { id, ownerId, type });
  registry.weapons.set(id, weapon);
  return weapon;
}

export function registerSoldier(registry, actor) {
  if (!actor.id || registry.soldiers.has(actor.id) || !registry.units.has(actor.unitId)) throw new Error(`Invalid soldier ownership: ${actor.id}`);
  actor.vehicleId = actor.seatId = null;
  registry.soldiers.set(actor.id, actor);
  return actor;
}

export function createVehicleEntity(registry, { id, unitId, type, position, team }) {
  if (!['tank', 'plane'].includes(type) || registry.vehicles.has(id) || !registry.units.has(unitId)) throw new Error(`Invalid vehicle: ${id}`);
  const settings = TYPES[type];
  const seats = type === 'tank' ? TANK_SEATS : [{ role: 'pilot', label: '飞行员', eyeHeight: 1.67, canFire: true }];
  const vehicle = { id, unitId, team, type, position: copyPosition(position), health: settings.health, heading: 0, pitch: 0,
    turretYaw: 0, throttle: 1, outsideTime: 0, speed: 0, crewLossLevel: 0, crewIds: [],
    seats: seats.map((seat, index) => ({ ...seat, id: `${id}:seat-${index}`, occupantId: null })),
    weapon: registerWeapon(registry, { ammo: settings.magazine, nextShot: 0, reloadUntil: 0 }, `${id}:primary`, id, type) };
  registry.vehicles.set(id, vehicle);
  return vehicle;
}

export function occupiedVehicle(registry, actor) {
  if (!actor?.vehicleId) return null;
  const vehicle = registry.vehicles.get(actor.vehicleId);
  if (!vehicle || !vehicle.seats.some(seat => seat.id === actor.seatId && seat.occupantId === actor.id)) throw new Error(`Broken seat ownership: ${actor.id}`);
  return vehicle;
}

export function seatSoldier(registry, actor, vehicle, seatId) {
  const seat = vehicle.seats.find(item => item.id === seatId);
  if (actor.health <= 0 || vehicle.health <= 0) return '人员或载具已失去作战能力';
  if (actor.team !== vehicle.team || actor.unitId !== vehicle.unitId) return '当前只允许本单位车组返回原车';
  if (!vehicle.crewIds.includes(actor.id) && vehicle.crewIds.length >= vehicle.seats.length) return '这不是该士兵原有的车组';
  if (actor.vehicleId) return '先离开当前席位';
  if (!seat || seat.occupantId) return '席位已被占用';
  seat.occupantId = actor.id; actor.vehicleId = vehicle.id; actor.seatId = seat.id;
  if (!vehicle.crewIds.includes(actor.id)) vehicle.crewIds.push(actor.id);
  Object.assign(actor.position, { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z });
  actor.targetKind = vehicle.type === 'tank' ? 'closed-armor' : 'aircraft';
  return null;
}

export function releaseSeat(registry, actor) {
  const vehicle = occupiedVehicle(registry, actor);
  if (!vehicle) return;
  vehicle.seats.find(seat => seat.id === actor.seatId).occupantId = null;
  actor.vehicleId = actor.seatId = null;
  actor.targetKind = 'person';
}

export function leaveGroundVehicle(registry, actor, exit) {
  const vehicle = occupiedVehicle(registry, actor);
  if (!vehicle || vehicle.type !== 'tank') return '本轮只支持地面坦克离车；空中离机仍待实现';
  if (actor.health <= 0) return '阵亡成员不能离车';
  if (!exit) return '车门出口受阻，请移动载具后再试';
  releaseSeat(registry, actor);
  Object.assign(actor.position, { x: exit.x, y: exit.y, z: exit.z });
  return null;
}

export function selectControlledSoldier(registry, actor) {
  if (!actor || actor.health <= 0 || actor.unitId !== registry.control.unitId) return false;
  registry.control.soldierId = actor.id;
  return true;
}

export function controlledSoldier(registry) { return registry.soldiers.get(registry.control.soldierId) || null; }
export function controlledType(registry) {
  const actor = controlledSoldier(registry);
  return occupiedVehicle(registry, actor)?.type || actor?.groundType || 'infantry';
}

export function controlledWeapon(registry) {
  const actor = controlledSoldier(registry);
  if (!actor) return null;
  return occupiedVehicle(registry, actor)?.weapon || (actor.groundType === 'mortar' ? registry.units.get(actor.unitId).supportWeapon : actor.rifle);
}

export function controlOwner(registry) {
  const actor = controlledSoldier(registry);
  if (!actor) return null;
  return { unitId: actor.unitId, soldierId: actor.id, vehicleId: actor.vehicleId, seatId: actor.seatId,
    weaponId: controlledWeapon(registry).id };
}

export function createControlView(registry) {
  const vehicle = () => occupiedVehicle(registry, controlledSoldier(registry));
  const actor = () => controlledSoldier(registry);
  const formation = () => registry.units.get(registry.control.unitId);
  return {
    get type() { return controlledType(registry); },
    get squadId() { return formation()?.squadId; },
    get spawnId() { return formation()?.spawnId; },
    get ammo() { return controlledWeapon(registry)?.ammo; },
    set ammo(value) { controlledWeapon(registry).ammo = value; },
    get nextShot() { return controlledWeapon(registry)?.nextShot || 0; },
    set nextShot(value) { controlledWeapon(registry).nextShot = value; },
    get reloadUntil() { return controlledWeapon(registry)?.reloadUntil || 0; },
    set reloadUntil(value) { controlledWeapon(registry).reloadUntil = value; },
    get altitude() { return vehicle()?.position.y ?? actor()?.position.y ?? 0; },
    set altitude(value) { (vehicle()?.position || actor().position).y = value; },
    get heading() { return vehicle()?.heading || 0; },
    set heading(value) { vehicle().heading = value; },
    get throttle() { return vehicle()?.throttle ?? 1; },
    set throttle(value) { vehicle().throttle = value; },
    get vehicleHealth() { return vehicle()?.health ?? null; },
  };
}

export function vehicleCollider(vehicle) {
  return { id: vehicle.id, oriented: true, cx: vehicle.position.x, cz: vehicle.position.z, hx: 1.85, hz: 2.5,
    angle: vehicle.heading, cos: Math.cos(vehicle.heading), sin: Math.sin(vehicle.heading),
    minX: vehicle.position.x - 3.2, maxX: vehicle.position.x + 3.2, minZ: vehicle.position.z - 3.2, maxZ: vehicle.position.z + 3.2, height: 2.4 };
}

export function groundExit(vehicle, clear, height) {
  for (const [x, z] of [[3.1, -.7], [-3.1, -.7], [3.1, 1.4], [-3.1, 1.4], [0, 3.8]]) {
    const c = Math.cos(vehicle.heading), s = Math.sin(vehicle.heading);
    const point = { x: vehicle.position.x + x * c + z * s, z: vehicle.position.z - x * s + z * c };
    const from = { x: vehicle.position.x + x * .72 * c + z * .72 * s, z: vehicle.position.z - x * .72 * s + z * .72 * c };
    if (clear(point, from)) return { ...point, y: height(point.x, point.z) };
  }
  return null;
}

export function damageVehicleEntity(registry, vehicle, amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Vehicle damage must be non-negative and finite');
  const previous = vehicle.health;
  vehicle.health = Math.max(0, previous - amount);
  const occupants = vehicle.seats.map(seat => registry.soldiers.get(seat.occupantId)).filter(actor => actor?.health > 0);
  const casualties = [];
  if (vehicle.health === 0 && previous > 0) {
    for (const actor of occupants) { actor.health = 0; casualties.push(actor); }
  } else if (vehicle.type === 'tank' && vehicle.health > 0) {
    const lost = Math.floor((TYPES.tank.health - vehicle.health) / 120);
    if (lost > vehicle.crewLossLevel && occupants.length > 1) {
      const actor = occupants.find(actor => actor.id === registry.control.soldierId) || occupants[0];
      actor.health = 0; casualties.push(actor);
    }
    vehicle.crewLossLevel = Math.max(vehicle.crewLossLevel, lost);
  }
  return { damage: previous - vehicle.health, destroyed: previous > 0 && vehicle.health === 0, casualties };
}

export function resetEntities(registry) {
  for (const map of [registry.units, registry.soldiers, registry.weapons, registry.vehicles]) map.clear();
  registry.control.unitId = registry.control.soldierId = null;
}
// ---模块结束---
