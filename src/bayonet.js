export const BAYONET = Object.freeze({
  chargeRange: 8, disengageRange: 11, reach: 1.65, floorTolerance: .6,
  windup: .22, returnTime: .22, cooldown: 1.1, damage: 65, tipZ: -1.35,
});

export function hasBayonet(actor) {
  return actor.team === 'enemy' && actor.groundType === 'infantry' && (actor.rifle?.model ?? 'rifle') === 'rifle';
}

export function createBayonetState() {
  return { mode: 'idle', targetId: null, startedAt: null, nextAttackAt: 0, pending: false, extension: 0, strikes: 0, hits: 0 };
}

export function bayonetPoseReady(actor) {
  if ((actor.stance ?? 'standing') !== 'standing') return false;
  if (!actor.nativeMotion) return true;
  return Object.values(actor.nativeMotion.posture).reduce((sum, weight) => sum + weight, 0) <= .001 &&
    actor.nativeMotion.speed <= .25 && actor.nativeMotion.weight <= .15;
}

export function bayonetCarry(extension) {
  if (!Number.isFinite(extension) || extension < 0 || extension > 1) {
    throw new RangeError('Bayonet carry requires a bounded thrust extension');
  }
  const lift = extension * extension * (3 - 2 * extension);
  return { position: [.10, 1.16 + .04 * lift, .04 - .14 * lift], pitch: .06 + .12 * lift };
}

export function cancelBayonet(state) {
  state.mode = 'idle'; state.targetId = state.startedAt = null;
  state.pending = false; state.extension = 0;
}

export function bayonetDistance(actor, target) {
  return closeCombatDistance(actor, target, hasBayonet(actor), BAYONET.floorTolerance);
}

export function closeCombatDistance(actor, target, equipped, floorTolerance) {
  if (!equipped || actor.health <= 0 || actor.vehicleId || actor.grenades?.action ||
    !target || target.health <= 0 || target.team === actor.team || target.vehicleId ||
    !['person', 'exposed-crew'].includes(target.targetKind) ||
    Math.abs(actor.position.y - target.position.y) > floorTolerance) return null;
  return Math.hypot(actor.position.x - target.position.x, actor.position.z - target.position.z);
}

export function advanceBayonet(actor, target, { now, visible, facing, settled }) {
  if (!Number.isFinite(now) || now < 0 || ![visible, facing, settled].every(value => typeof value === 'boolean')) {
    throw new RangeError('Bayonet combat requires explicit time, sight, facing and posture facts');
  }
  const state = actor.bayonet, distance = bayonetDistance(actor, target);
  const continuing = state.mode !== 'idle' && state.targetId === target?.id;
  if (distance === null || distance > (continuing ? BAYONET.disengageRange : BAYONET.chargeRange) || !visible) {
    cancelBayonet(state);
    return { active: false, hit: false };
  }
  if (!continuing) { cancelBayonet(state); state.targetId = target.id; }
  state.extension = 0;
  if (state.startedAt !== null) {
    const elapsed = now - state.startedAt;
    state.extension = Math.max(0, elapsed <= BAYONET.windup ? elapsed / BAYONET.windup
      : 1 - (elapsed - BAYONET.windup) / BAYONET.returnTime);
    if (state.pending && elapsed + 1e-8 >= BAYONET.windup) {
      state.pending = false;
      const hit = distance <= BAYONET.reach && facing && settled;
      if (hit) state.hits++;
      state.mode = 'recover';
      return { active: true, hit };
    }
    if (elapsed < BAYONET.windup + BAYONET.returnTime) {
      state.mode = state.pending ? 'thrust' : 'recover';
      return { active: true, hit: false };
    }
  }
  state.mode = distance > BAYONET.reach ? 'charge' : 'recover';
  if (distance <= BAYONET.reach && facing && settled && now >= state.nextAttackAt) {
    state.mode = 'thrust'; state.startedAt = now; state.pending = true;
    state.nextAttackAt = now + BAYONET.cooldown; state.strikes++;
  }
  return { active: true, hit: false };
}
