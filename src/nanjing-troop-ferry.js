import { Vector3 } from 'three';
import { NANJING_BOAT_CAPACITY } from './nanjing-campaign.js';
import { NANJING_FERRY_FLOOR } from './nanjing-river-details.js';

export function troopFerryWaitPoint(actor, ferries) {
  if (!ferries.length) throw new Error('Troop evacuation requires an actual ferry');
  const ferry = ferries[actor.index % ferries.length];
  return { x: -72.2, z: ferry.position.z, transit: true };
}

export function beginTroopFerryBoarding(ferry, actors, time, shorePath, allowPlayerUnit = false) {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Troop boarding requires finite simulation time');
  const data = ferry.userData;
  data.troopPassengers ??= [];
  data.troopPassengers = data.troopPassengers.filter(passenger => passenger.actor.health > 0);
  if (data.state !== 'docked' || data.boarding || data.troopBoarding ||
    data.troopPassengers.length >= NANJING_BOAT_CAPACITY) return false;
  const shore = { x: -72.2, z: ferry.position.z };
  const candidates = actors.filter(actor => actor.team === 'friendly' && (!actor.playerUnit || allowPlayerUnit) && actor.health > 0 && !actor.vehicleId &&
    !actor.grenades?.action && actor.traversal?.kind === 'grounded' &&
    !actor.tactics.nanjingFerry && Math.hypot(actor.position.x - shore.x, actor.position.z - shore.z) < 3)
    .sort((a, b) => a.position.distanceToSquared(ferry.position) - b.position.distanceToSquared(ferry.position) || a.id.localeCompare(b.id));
  const actor = candidates[0];
  if (!actor) return false;
  const path = shorePath(actor, shore);
  if (path == null) return false;
  if (!Array.isArray(path) || !path.length && Math.hypot(actor.position.x - shore.x, actor.position.z - shore.z) > .02)
    throw new Error('Troop boarding requires a route to the shore or an actor already at that shore point');
  const seat = Array.from({ length: NANJING_BOAT_CAPACITY }, (_, index) => index)
    .find(index => !data.troopPassengers.some(passenger => passenger.seat === index));
  const local = new Vector3((Math.floor(seat / 2) - 2) * .9, NANJING_FERRY_FLOOR, seat % 2 ? .4 : -.4);
  const target = ferry.localToWorld(local.clone());
  actor.tactics.nanjingFerry = { ferryId: data.ferryId, phase: 'boarding', speed: 0 };
  data.troopBoarding = { actor, seat, local, path: [...path,
    { x: -74.3, z: ferry.position.z, y: target.y }, { x: target.x, y: target.y, z: target.z }] };
  data.troopsLoadedAt ??= time;
  return true;
}

export function advanceTroopFerryBoarding(ferry, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Troop boarding requires a non-negative finite timestep');
  if (dt === 0) return null;
  const data = ferry.userData, boarding = data.troopBoarding;
  if (!boarding) return null;
  const { actor, path } = boarding;
  if (actor.health <= 0) { data.troopBoarding = null; delete actor.tactics.nanjingFerry; return null; }
  const target = path[0], delta = new Vector3(target.x, target.y, target.z).sub(actor.position);
  const distance = delta.length(), moved = Math.min(distance, 3.2 * dt);
  if (distance > 1e-8) {
    actor.position.addScaledVector(delta, moved / distance);
    if (Math.hypot(delta.x, delta.z) > .001) actor.heading = Math.atan2(-delta.x, -delta.z);
    actor.walkPhase += moved * 3.6; actor.walkPoseReady = moved > .001;
  }
  actor.tactics.nanjingFerry.speed = dt > 0 ? moved / dt : 0;
  actor.locomotion.speed = actor.tactics.nanjingFerry.speed;
  actor.locomotion.mode = 'walk'; actor.stance = 'standing';
  if (distance <= moved + 1e-6) path.shift();
  if (!path.length) {
    actor.tactics.nanjingFerry.phase = 'aboard';
    actor.tactics.nanjingFerry.speed = 0;
    data.troopPassengers.push({ actor, local: boarding.local, seat: boarding.seat });
    data.troopBoarding = null;
  }
  return { actor, moved };
}

export function syncTroopFerryPassengers(ferry, controlledId = null) {
  const data = ferry.userData;
  if (!data.troopPassengers?.length) return;
  data.troopPassengers = data.troopPassengers.filter(({ actor }) => {
    if (actor.health > 0) return true;
    delete actor.tactics.nanjingFerry;
    return false;
  });
  ferry.updateWorldMatrix(true, false);
  for (const { actor, local, deckControlled } of data.troopPassengers) {
    actor.position.copy(local).applyMatrix4(ferry.matrixWorld);
    if (actor.nativeMotion) {
      // Carrier motion is not a walking stride made by the passenger.
      actor.nativeMotion.position.x = actor.position.x;
      actor.nativeMotion.position.z = actor.position.z;
    }
    if (!deckControlled) {
      if (actor.id !== controlledId) actor.heading = ferry.rotation.y;
      actor.stance = 'crouched';
      actor.locomotion.speed = 0; actor.locomotion.mode = 'idle'; actor.walkPoseReady = false;
    }
  }
}

export function troopFerryReady(ferry, actors, time, holdForPlayer = false) {
  const data = ferry.userData;
  return data.state === 'docked' && !data.troopBoarding && data.troopPassengers?.length > 0 &&
    (data.troopPassengers.length >= NANJING_BOAT_CAPACITY ||
      !holdForPlayer && (time - data.troopsLoadedAt >= 15 ||
      !actors.some(actor => actor.health > 0 && !actor.vehicleId && !actor.tactics.nanjingFerry)));
}

export function playerFerryReady(ferry, squad, playerId) {
  const data = ferry.userData, people = data.troopPassengers ?? [];
  const player = people.find(passenger => passenger.actor.id === playerId && passenger.actor.health > 0);
  return data.state === 'docked' && !data.troopBoarding && Boolean(player) &&
    (people.length >= NANJING_BOAT_CAPACITY ||
      squad.filter(actor => actor.health > 0).every(actor => people.some(passenger => passenger.actor.id === actor.id)));
}

export function completeTroopFerryCrossing(ferry) {
  const passengers = (ferry.userData.troopPassengers ?? []).filter(({ actor }) => actor.health > 0);
  for (const { actor } of passengers) actor.tactics.nanjingFerry.phase = 'evacuated';
  ferry.userData.troopPassengers = [];
  return passengers.map(passenger => passenger.actor);
}
