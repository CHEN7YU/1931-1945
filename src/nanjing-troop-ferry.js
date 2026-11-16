import { Vector3, Raycaster } from 'three';
import { NANJING_BOAT_CAPACITY } from './nanjing-campaign.js';
import { NANJING_FERRY_FLOOR } from './nanjing-river-details.js';

export const FINAL_BOARDING_FIRE_BUFFER_SECONDS = 16;

export function startFinalBoardingFireBuffer(campaign, actor, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Boarding fire buffer requires simulation time');
  if (campaign.stage !== 'withdrawal-to-boats' || campaign.embarkFireBufferStartedAt != null ||
    actor?.health <= 0 || !actor?.playerUnit || actor.tactics?.nanjingFerry?.phase !== 'boarding') return false;
  campaign.embarkFireBufferStartedAt = now;
  campaign.embarkFireBufferUntil = now + FINAL_BOARDING_FIRE_BUFFER_SECONDS;
  return true;
}

export function finalBoardingFireHeld(campaign, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Boarding fire buffer requires simulation time');
  return Boolean(campaign?.stage === 'withdrawal-to-boats' &&
    (campaign.playerBoardingBoatId != null ||
      campaign.embarkFireBufferStartedAt != null && now < campaign.embarkFireBufferUntil));
}

export function finalBoardingDamageHeld(campaign, now, source, target) {
  return source?.team === 'enemy' && target?.team === 'friendly' && finalBoardingFireHeld(campaign, now);
}

export function retainTroopFerryCasualty(ferry, actor) {
  const support = actor?.tactics?.nanjingFerry;
  if (actor?.health > 0 || !support || !['boarding', 'aboard'].includes(support.phase) ||
    support.ferryId !== ferry.userData.ferryId) return false;
  ferry.updateWorldMatrix(true, false);
  const local = ferry.worldToLocal(actor.position.clone());
  const beam = .045 + .89 * Math.pow(Math.max(0, 1 - (local.x / 3.22) ** 2), .65);
  let anchor = ferry, point = actor.position.clone();
  const plank = ferry.userData.gangplank;
  if (support.phase === 'boarding' && plank?.visible) {
    plank.updateWorldMatrix(true, true);
    const ray = new Raycaster(point.clone().add(new Vector3(0, .4, 0)), new Vector3(0, -1, 0), 0, .8);
    const hit = ray.intersectObject(plank, true)[0];
    if (hit) { anchor = plank; point.y = hit.point.y; }
  }
  if (anchor === ferry && (Math.abs(local.x) > 3.2 || Math.abs(local.z) > beam)) return false;
  const corpses = ferry.userData.troopCorpses ??= [];
  if (corpses.some(corpse => corpse.actor === actor)) return true;
  actor.position.copy(point);
  actor.tactics.corpseFerry = { ferryId: support.ferryId, support: anchor === ferry ? 'deck' : 'gangplank' };
  corpses.push({ actor, local: anchor.worldToLocal(point.clone()), anchor,
    heading: actor.heading - ferry.rotation.y, velocity: 0 });
  return true;
}

export function syncTroopFerryCorpses(ferry, { dt = 0, groundAt = null } = {}) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Ferry casualty support requires finite simulation time');
  const corpses = ferry.userData.troopCorpses;
  if (!corpses?.length) return;
  ferry.updateWorldMatrix(true, false);
  ferry.userData.troopCorpses = corpses.filter(record => {
    const { actor, heading } = record;
    if (actor.corpseRemoved) return false;
    if (actor.health > 0) throw new Error('Ferry casualty support contains a living soldier');
    if (record.anchor !== ferry && !record.anchor.visible) {
      if (typeof groundAt !== 'function') throw new Error('Removed boarding support requires the actual terrain height');
      record.velocity += 9.81 * dt; actor.position.y -= record.velocity * dt;
      const local = ferry.worldToLocal(actor.position.clone());
      const beam = .045 + .89 * Math.pow(Math.max(0, 1 - (local.x / 3.22) ** 2), .65);
      const deck = ferry.localToWorld(new Vector3(local.x, NANJING_FERRY_FLOOR, local.z));
      if (Math.abs(local.x) <= 3.2 && Math.abs(local.z) <= beam && actor.position.y <= deck.y) {
        actor.position.y = deck.y; record.anchor = ferry;
        record.local = ferry.worldToLocal(actor.position.clone()); record.heading = actor.heading - ferry.rotation.y;
        actor.tactics.corpseFerry.support = 'deck';
      } else {
        const floor = groundAt(actor.position.x, actor.position.z, actor.position.y);
        if (!Number.isFinite(floor)) throw new Error('Invalid ground under a removed boarding plank');
        if (actor.position.y <= floor) {
          actor.position.y = floor; delete actor.tactics.corpseFerry; return false;
        }
      }
    } else {
      record.anchor.updateWorldMatrix(true, false);
      actor.position.copy(record.local).applyMatrix4(record.anchor.matrixWorld);
      actor.heading = ferry.rotation.y + heading;
    }
    return true;
  });
}

export function troopFerryWaitPoint(actor, ferries, reservedFerryId = null) {
  if (!ferries.length) throw new Error('Troop evacuation requires an actual ferry');
  const start = actor.index % ferries.length;
  const ferry = Array.from({ length: ferries.length }, (_, offset) => ferries[(start + offset) % ferries.length])
    .find(candidate => candidate.userData.state === 'docked' &&
      (candidate.userData.troopPassengers?.length ?? 0) <
        NANJING_BOAT_CAPACITY - Number(candidate.userData.ferryId === reservedFerryId)) ?? ferries[start];
  return { x: -72.2, z: ferry.position.z, transit: true };
}

export function playerTroopFerryReady(ferry, player, campaign) {
  const data = ferry.userData;
  return Boolean(player?.health > 0 && data.state === 'docked' && !data.boarding && !data.troopBoarding &&
    campaign.playerBoardingBoatId === data.ferryId &&
    player.tactics.nanjingFerry?.phase === 'aboard' &&
    player.tactics.nanjingFerry.ferryId === data.ferryId &&
    data.troopPassengers?.some(passenger => passenger.actor === player));
}

export function beginTroopFerryBoarding(ferry, actors, time, shorePath, allowPlayerUnit = false) {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Troop boarding requires finite simulation time');
  const data = ferry.userData;
  data.troopPassengers ??= [];
  data.troopPassengers = data.troopPassengers.filter(passenger => passenger.actor.health > 0);
  if (data.state !== 'docked' || data.boarding || data.troopBoarding ||
    time < (data.troopNextRouteAttemptAt ?? 0) ||
    data.troopPassengers.length >= NANJING_BOAT_CAPACITY) return false;
  const shore = { x: -72.2, z: ferry.position.z };
  const candidates = actors.filter(actor => actor.team === 'friendly' && (!actor.playerUnit || allowPlayerUnit) && actor.health > 0 && !actor.vehicleId &&
    !actor.grenades?.action && actor.traversal?.kind === 'grounded' &&
    !actor.tactics.nanjingFerry && time >= (actor.tactics.nanjingFerryRetryAt?.[data.ferryId] ?? 0) &&
    Math.hypot(actor.position.x - shore.x, actor.position.z - shore.z) < 3)
    .sort((a, b) => a.position.distanceToSquared(ferry.position) - b.position.distanceToSquared(ferry.position) || a.id.localeCompare(b.id));
  const actor = candidates[0];
  if (!actor) return false;
  const path = shorePath(actor, shore);
  if (path == null) {
    actor.tactics.nanjingFerryRetryAt ??= {};
    actor.tactics.nanjingFerryRetryAt[data.ferryId] = time + 10;
    data.troopNextRouteAttemptAt = time + 1;
    return false;
  }
  if (!Array.isArray(path) || !path.length && Math.hypot(actor.position.x - shore.x, actor.position.z - shore.z) > .02)
    throw new Error('Troop boarding requires a route to the shore or an actor already at that shore point');
  const seat = Array.from({ length: NANJING_BOAT_CAPACITY }, (_, index) => index)
    .find(index => !data.troopPassengers.some(passenger => passenger.seat === index));
  const local = new Vector3((Math.floor(seat / 2) - 2) * .9, NANJING_FERRY_FLOOR, seat % 2 ? .4 : -.4);
  const target = ferry.localToWorld(local.clone());
  delete actor.tactics.nanjingFerryRetryAt;
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

export function completeTroopFerryCrossing(ferry) {
  const passengers = (ferry.userData.troopPassengers ?? []).filter(({ actor }) => actor.health > 0);
  for (const { actor } of passengers) actor.tactics.nanjingFerry.phase = 'evacuated';
  ferry.userData.troopPassengers = [];
  return passengers.map(passenger => passenger.actor);
}
