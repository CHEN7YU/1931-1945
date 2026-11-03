import { TYPES } from './core.js';
import { nativeMuzzleLocal, nativeGaitDrop, nativeEyeLocal, syncNativeAimGoal } from './nra-motion.js';
import { FIRING_POSES } from './combat-posture.js';
import { infantryWeaponProfile } from './rifle-action.js';
import { CHI_HA, CHI_HA_SEATS, CHI_HA_MG, CHI_HA_MG_MOUNTS } from './chi-ha.js';
import { TANK_MACHINE_GUN, TANK_OBSERVATION } from './player-tank.js';
import { attackCategory } from './battle-stats.js';
import { headingError } from './ai-turning.js';
import { createTraversal } from './infantry-traversal.js';
import { createWeaponMount } from './weapon-mount.js';

const copyPosition = position => position.clone ? position.clone() : { ...position };
const stanceHeights = Object.freeze({ standing: 1.67, crouched: 1.05, prone: .45 });
export const SOLDIER_FIRE_HEIGHT = 1.39;
export function soldierPostureHeight(actor, kind = 'eye') {
  const heights = kind === 'eye' ? [1.67, 1.05, .45] : kind === 'aim' ? [1.1, .7, .3] : kind === 'body' ? [1.82, 1.2, .65] : null;
  if (!heights) throw new RangeError('Unknown soldier posture height');
  if (actor.stance != null && !Object.hasOwn(stanceHeights, actor.stance)) throw new RangeError('Unknown personal stance');
  if (actor.vehicleId) return heights[0];
  if (kind === 'eye' && actor.nativeMotion?.profile?.headAim) return nativeEyeLocal(actor)[1];
  const posture = actor.nativeMotion?.posture ?? { crouched: actor.stance === 'crouched' ? 1 : 0, prone: actor.stance === 'prone' ? 1 : 0 };
  const entries = Object.entries(posture), total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (entries.some(([pose, weight]) => !FIRING_POSES[pose] || !Number.isFinite(weight) || weight < 0 || weight > 1) ||
    total > 1.00001) throw new RangeError('Invalid owned posture blend');
  const drop = nativeGaitDrop(actor);
  const height = heights[0] * Math.max(0, 1 - total) + entries.reduce((sum, [pose, weight]) => sum + FIRING_POSES[pose][kind] * weight, 0) - drop;
  const pivot = actor.nativeMotion?.profile?.leanPivot?.[1] - drop, lean = (actor.nativeMotion?.bodyLean ?? 0) * Math.max(0, 1 - total);
  return Number.isFinite(pivot) && height > pivot ? pivot + (height - pivot) * Math.cos(lean) : height;
}
export function soldierEyePosition(actor) {
  if (!actor?.position ||
    !['x', 'y', 'z'].every(axis => Number.isFinite(actor.position[axis]))) throw new RangeError('Eye projection requires a finite owned pose');
  if (!actor.vehicleId && actor.nativeMotion?.profile?.headAim) {
    if (!Number.isFinite(actor.heading)) throw new RangeError('Native eye projection requires a finite heading');
    const [x, y, z] = nativeEyeLocal(actor), c = Math.cos(actor.heading), s = Math.sin(actor.heading);
    return { x: actor.position.x + x * c + z * s, y: actor.position.y + y, z: actor.position.z - x * s + z * c };
  }
  return { x: actor.position.x, y: actor.position.y + soldierPostureHeight(actor), z: actor.position.z };
}
export const TANK_SEATS = Object.freeze([
  Object.freeze({ role: 'commander', label: '车长', eyeHeight: TANK_OBSERVATION.commander.eyeHeight, canFire: true, controlsTurret: true }),
  Object.freeze({ role: 'gunner', label: '炮手', eyeHeight: TANK_OBSERVATION.gunner.eyeHeight, canFire: true, controlsTurret: true }),
  Object.freeze({ role: 'driver', label: '驾驶员', eyeHeight: 1.3, canFire: false, controlsTurret: false }),
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

export function releaseSupportWeapon(registry, unit) {
  const weapon = unit.supportWeapon;
  if (!weapon) return;
  if (registry.units.get(unit.id) !== unit || weapon.ownerId !== unit.id || registry.weapons.get(weapon.id) !== weapon) throw new Error(`Broken support weapon ownership: ${unit.id}`);
  registry.weapons.delete(weapon.id);
  unit.supportWeapon = null;
}

export function registerSoldier(registry, actor) {
  if (!actor.id || registry.soldiers.has(actor.id) || !registry.units.has(actor.unitId)) throw new Error(`Invalid soldier ownership: ${actor.id}`);
  actor.vehicleId = actor.seatId = null;
  actor.stance = 'standing'; actor.manualStance = null; actor.lookPitch = 0;
  actor.traversal = createTraversal();
  actor.weaponMount = createWeaponMount();
  registry.soldiers.set(actor.id, actor);
  return actor;
}

export function createVehicleEntity(registry, { id, unitId, type, position, team, variant = null }) {
  if (typeof id !== 'string' || !id || !position || !['x', 'y', 'z'].every(axis => Number.isFinite(position[axis])) ||
    !['tank', 'plane'].includes(type) || (variant !== null && (variant !== CHI_HA.id || type !== 'tank' || team !== 'enemy')) ||
    registry.vehicles.has(id) || !registry.units.has(unitId)) throw new Error(`Invalid vehicle: ${id}`);
  const settings = variant === CHI_HA.id ? CHI_HA : TYPES[type];
  const seats = variant === CHI_HA.id ? CHI_HA_SEATS : type === 'tank' ? TANK_SEATS : [{ role: 'pilot', label: '飞行员', eyeHeight: 1.67, canFire: true }];
  const vehicle = { id, unitId, team, type, variant, position: copyPosition(position), health: settings.health, maxHealth: settings.health, heading: 0, pitch: 0, roll: 0,
    turretYaw: 0, turretPitch: 0, throttle: 1, outsideTime: 0, speed: 0, trackDistance: 0, crewLossLevel: 0, crewIds: [],
    seats: seats.map((seat, index) => ({ ...seat, id: `${id}:seat-${index}`, occupantId: null, viewYaw: 0, viewPitch: 0 })),
    weapon: registerWeapon(registry, { ammo: settings.magazine, nextShot: 0, reloadUntil: 0,
      ...(variant === CHI_HA.id ? { settings } : {}) }, `${id}:primary`, id, type) };
  if (variant === CHI_HA.id) vehicle.machineGuns = CHI_HA_MG_MOUNTS.map(mount =>
    registerWeapon(registry, { mount: mount.id, settings: CHI_HA_MG, ammo: CHI_HA_MG.magazine,
      nextShot: 0, reloadUntil: 0, cooldownUntil: 0, burstLeft: CHI_HA_MG.burst,
      shots: 0, yaw: 0, pitch: 0, mode: 'search', targetId: null }, `${id}:mg-${mount.id}`, id, type));
  else if (type === 'tank') vehicle.machineGuns = [registerWeapon(registry,
    { mount: 'coax', settings: TANK_MACHINE_GUN, ammo: TANK_MACHINE_GUN.magazine,
      nextShot: 0, reloadUntil: 0, shots: 0, mode: 'idle' }, `${id}:mg-coax`, id, type)];
  registry.vehicles.set(id, vehicle);
  return vehicle;
}

export function occupiedVehicle(registry, actor) {
  if (!actor?.vehicleId) return null;
  const vehicle = registry.vehicles.get(actor.vehicleId);
  if (!vehicle || !vehicle.seats.some(seat => seat.id === actor.seatId && seat.occupantId === actor.id)) throw new Error(`Broken seat ownership: ${actor.id}`);
  return vehicle;
}

export function occupiedSeat(registry, actor = controlledSoldier(registry)) {
  return occupiedVehicle(registry, actor)?.seats.find(seat => seat.id === actor.seatId) || null;
}

export function seatSoldier(registry, actor, vehicle, seatId) {
  const seat = vehicle.seats.find(item => item.id === seatId);
  if (actor.health <= 0 || vehicle.health <= 0) return '人员或载具已失去作战能力';
  if (actor.team !== vehicle.team || actor.unitId !== vehicle.unitId) return '当前只允许本单位车组返回原车';
  if (!vehicle.crewIds.includes(actor.id) && vehicle.crewIds.length >= vehicle.seats.length) return '这不是该士兵原有的车组';
  if (actor.vehicleId) return '先离开当前席位';
  if (!seat || seat.occupantId) return '席位已被占用';
  seat.occupantId = actor.id; actor.vehicleId = vehicle.id; actor.seatId = seat.id;
  actor.stance = 'standing'; actor.manualStance = null; actor.firingPose = null;
  Object.assign(actor.traversal, createTraversal());
  Object.assign(actor.weaponMount, createWeaponMount());
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
  if (!actor.vehicleId && actor.manualStance != null) {
    actor.stance = actor.manualStance; actor.firingPose = null;
    if (actor.nativeMotion) for (const pose of Object.keys(actor.nativeMotion.posture)) {
      actor.nativeMotion.posture[pose] = pose === actor.stance && actor.nativeMotion.profile[pose] ? 1 : 0;
    }
    syncNativeAimGoal(actor);
  }
  registry.control.soldierId = actor.id;
  return true;
}

export function controlledSoldier(registry) { return registry.soldiers.get(registry.control.soldierId) || null; }
export function soldierRifleMuzzle(actor) {
  if (!actor || !['friendly', 'enemy'].includes(actor.team) || !Number.isFinite(actor.heading) ||
    !actor.position || !['x', 'y', 'z'].every(axis => Number.isFinite(actor.position[axis]))) throw new RangeError('Soldier muzzle requires a finite owned position, heading and team');
  const c = Math.cos(actor.heading), s = Math.sin(actor.heading);
  const profile = infantryWeaponProfile(actor.rifle);
  const local = actor.nativeMotion ? nativeMuzzleLocal(actor) : profile.automatic
    ? { x: .13 + profile.muzzleX, y: SOLDIER_FIRE_HEIGHT, z: .02 + profile.muzzleZ }
    : { x: .13, y: SOLDIER_FIRE_HEIGHT, z: actor.team === 'friendly' ? -.871 : -1.07 };
  return { x: local.x * c + local.z * s + actor.position.x, y: local.y + actor.position.y,
    z: -local.x * s + local.z * c + actor.position.z };
}

export function controlledType(registry) {
  const actor = controlledSoldier(registry);
  return occupiedVehicle(registry, actor)?.type || actor?.groundType || 'infantry';
}

export function controlledWeapon(registry) {
  return soldierWeapon(registry, controlledSoldier(registry));
}

function soldierWeapon(registry, actor) {
  if (!actor) return null;
  if (actor.emplacementWeaponId) {
    const weapon = registry.weapons.get(actor.emplacementWeaponId);
    if (!weapon || weapon.ownerId !== actor.id) throw new Error('Broken fixed weapon ownership');
    return weapon;
  }
  return occupiedVehicle(registry, actor)?.weapon || (actor.groundType === 'mortar' ? registry.units.get(actor.unitId).supportWeapon : actor.rifle);
}

export function captureAttackSource(registry, actor, weapon = soldierWeapon(registry, actor)) {
  if (!actor || registry.soldiers.get(actor.id) !== actor || actor.health <= 0) throw new Error('Attack source requires a living registered soldier');
  if (!weapon?.ownerId || registry.weapons.get(weapon.id) !== weapon ||
    ![actor.id, actor.unitId, actor.vehicleId].includes(weapon.ownerId)) throw new Error('Attack source requires an owned registered weapon');
  return Object.freeze({ credit: actor === controlledSoldier(registry) ? 'player' : actor.team === 'friendly' ? 'ally' : 'enemy',
    team: actor.team, unitId: actor.unitId, soldierId: actor.id, weaponId: weapon.id,
    weaponClass: attackCategory(weapon), squadId: registry.units.get(actor.unitId).squadId ?? actor.unitId,
    unitName: registry.units.get(actor.unitId).scoreLabel ?? actor.unitId,
    vehicleId: actor.vehicleId, seatId: actor.seatId });
}

export function controlOwner(registry) {
  const actor = controlledSoldier(registry);
  if (!actor) return null;
  return { unitId: actor.unitId, soldierId: actor.id, vehicleId: actor.vehicleId, seatId: actor.seatId,
    weaponId: controlledWeapon(registry).id };
}

export function createControlPoseView(registry) {
  const selected = () => {
    const actor = controlledSoldier(registry);
    if (!actor || actor.health <= 0) throw new Error('Pose input requires a living controlled soldier');
    return actor;
  };
  return {
    get yaw() {
      const actor = controlledSoldier(registry), vehicle = occupiedVehicle(registry, actor);
      if (!vehicle) return actor?.heading ?? 0;
      if (vehicle.type === 'plane') return vehicle.heading;
      const seat = vehicle.seats.find(seat => seat.id === actor.seatId);
      return seat.controlsTurret ? vehicle.turretYaw : vehicle.heading + seat.viewYaw;
    },
    set yaw(value) {
      if (!Number.isFinite(value)) throw new RangeError('Look yaw must be finite');
      const actor = selected(), vehicle = occupiedVehicle(registry, actor);
      if (!vehicle) actor.heading = value;
      else if (vehicle.type === 'plane') vehicle.heading = value;
      else {
        const seat = vehicle.seats.find(seat => seat.id === actor.seatId);
        if (seat.controlsTurret) vehicle.turretYaw = value;
        else if (seat.role === 'driver') {
          const limit = TANK_OBSERVATION.driver.yawLimit;
          seat.viewYaw = Math.max(-limit, Math.min(limit, headingError(vehicle.heading, value)));
        } else seat.viewYaw = value - vehicle.heading;
      }
    },
    get pitch() {
      const actor = controlledSoldier(registry), vehicle = occupiedVehicle(registry, actor);
      if (!vehicle) return actor?.lookPitch ?? 0;
      if (vehicle.type === 'plane') return vehicle.pitch;
      const seat = vehicle.seats.find(seat => seat.id === actor.seatId);
      return seat.controlsTurret ? vehicle.turretPitch : seat.viewPitch;
    },
    set pitch(value) {
      if (!Number.isFinite(value)) throw new RangeError('Look pitch must be finite');
      const actor = selected(), vehicle = occupiedVehicle(registry, actor);
      const driver = vehicle?.type === 'tank' && vehicle.seats.find(seat => seat.id === actor.seatId).role === 'driver';
      const min = vehicle?.type === 'plane' ? -.7 : driver ? -TANK_OBSERVATION.driver.pitchLimit : -1.25;
      const max = vehicle?.type === 'plane' ? .65 : driver ? TANK_OBSERVATION.driver.pitchLimit : 1.25;
      const pitch = Math.max(min, Math.min(max, value));
      if (!vehicle) actor.lookPitch = pitch;
      else if (vehicle.type === 'plane') vehicle.pitch = pitch;
      else {
        const seat = vehicle.seats.find(seat => seat.id === actor.seatId);
        if (seat.controlsTurret) vehicle.turretPitch = pitch;
        else seat.viewPitch = pitch;
      }
    },
    get stance() {
      const actor = controlledSoldier(registry);
      return occupiedVehicle(registry, actor) ? 'standing' : actor?.stance ?? 'standing';
    },
    set stance(value) {
      if (!Object.hasOwn(stanceHeights, value)) throw new RangeError('Unknown personal stance');
      const actor = selected();
      if (occupiedVehicle(registry, actor)) throw new Error('Seated members cannot change foot stance');
      actor.stance = value;
      actor.manualStance = value;
      actor.firingPose = null;
    },
    get eyeHeight() {
      const actor = controlledSoldier(registry), vehicle = occupiedVehicle(registry, actor);
      return vehicle ? vehicle.seats.find(seat => seat.id === actor.seatId).eyeHeight : actor ? soldierPostureHeight(actor) : stanceHeights.standing;
    },
  };
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
  const chiHa = vehicle.variant === CHI_HA.id;
  return { id: vehicle.id, oriented: true, cx: vehicle.position.x, cz: vehicle.position.z, hx: chiHa ? CHI_HA.width / 2 : 1.85, hz: chiHa ? CHI_HA.length / 2 : 2.5,
    angle: vehicle.heading, cos: Math.cos(vehicle.heading), sin: Math.sin(vehicle.heading),
    minX: vehicle.position.x - 3.2, maxX: vehicle.position.x + 3.2, minZ: vehicle.position.z - 3.2, maxZ: vehicle.position.z + 3.2, height: chiHa ? CHI_HA.height : 2.4 };
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
    const lost = Math.floor(((vehicle.maxHealth ?? TYPES.tank.health) - vehicle.health) / ((vehicle.maxHealth ?? TYPES.tank.health) / 3));
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
