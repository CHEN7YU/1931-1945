import { createCasualtyState } from './casualties.js';

export const BLAST_REACTION = Object.freeze({ stagger: .16, fall: .65, roll: 1.2,
  brace: 1.85, rise: 3.05, duration: 3.4, cooldown: 6, minimumDamage: 12 });
export const BLAST_POSE_TIMES = Object.freeze([0, .16, .4, .65, 1.2, 1.85, 2.4, 3.05, 3.4]);
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (from, to, value) => { const t = clamp((value - from) / (to - from)); return t * t * (3 - 2 * t); };

export function beginBlastReaction(actor, origin, damage, now, motion, { force = false } = {}) {
  if (![origin?.x, origin?.z, damage, now, actor.heading].every(Number.isFinite) || damage < 0 || now < 0)
    throw new RangeError('Blast reaction requires finite impact geometry, damage and time');
  if (actor.vehicleId || actor.health <= 0 || actor.blastReaction || !force && now < (actor.blastRecoveryUntil ?? 0)) return false;
  let seed = 0;
  for (const letter of actor.id) seed = (Math.imul(seed, 31) + letter.charCodeAt(0)) >>> 0;
  if (!force && (actor.stance === 'prone' || damage < BLAST_REACTION.minimumDamage ||
    damage < 30 && (seed + Math.floor(now * 10)) % 100 >= 55)) return false;
  let x = actor.position.x - origin.x, z = actor.position.z - origin.z, length = Math.hypot(x, z);
  if (length < .001) { x = Math.sin(actor.heading); z = Math.cos(actor.heading); length = 1; }
  const direction = { x: x / length, z: z / length }, strength = clamp(damage / 70);
  const casualty = createCasualtyState({ ...actor, health: 0,
    lastHit: { ...actor.lastHit, direction, blast: true } }, now, motion, { retainGun: true });
  const angles = [-Math.PI / 2, Math.PI / 2, Math.PI, 0];
  const yaw = Math.atan2(Math.sin(Math.atan2(direction.x, direction.z) - actor.heading - angles[casualty.variant]),
    Math.cos(Math.atan2(direction.x, direction.z) - actor.heading - angles[casualty.variant]));
  actor.blastReaction = { elapsed: 0, direction, strength, push: .3 + strength * .7,
    returnStance: actor.stance ?? 'standing', casualty: { ...casualty, yaw, duration: 1 }, lethal: false };
  actor.blastRecoveryUntil = now + BLAST_REACTION.duration + BLAST_REACTION.cooldown;
  return true;
}

export function sampleBlastReaction(actor) {
  const state = actor.blastReaction;
  if (!state) return null;
  const t = state.elapsed;
  const recovery = smooth(BLAST_REACTION.brace, BLAST_REACTION.rise, t);
  const fall = smooth(BLAST_REACTION.stagger, BLAST_REACTION.fall, t) * (1 - recovery);
  const settle = 1 - smooth(BLAST_REACTION.rise, BLAST_REACTION.duration, t);
  const rolled = Math.sin(Math.PI * smooth(BLAST_REACTION.fall, BLAST_REACTION.brace, t)) * settle;
  const localX = state.direction.x * Math.cos(actor.heading) - state.direction.z * Math.sin(actor.heading);
  const localZ = state.direction.x * Math.sin(actor.heading) + state.direction.z * Math.cos(actor.heading);
  return { elapsed: t, fall, recovery, rolled, progress: fall, settle,
    phase: t < BLAST_REACTION.stagger ? 'stagger' : t < BLAST_REACTION.fall ? 'fall'
      : t < BLAST_REACTION.roll ? 'roll' : t < BLAST_REACTION.brace ? 'brace'
        : t < BLAST_REACTION.rise ? 'rise' : 'settle',
    eyeHeight: (state.returnStance === 'prone' ? .45 : state.returnStance === 'crouched' ? 1.05 : 1.67) * (1 - fall) + .27 * fall,
    pitch: localZ * .92 * fall, roll: -localX * .92 * fall + .2 * rolled,
    yaw: state.casualty.yaw * fall };
}

export function advanceBlastReaction(actor, dt, move) {
  if (!Number.isFinite(dt) || dt < 0 || typeof move !== 'function')
    throw new RangeError('Blast recovery requires finite time and a collision-aware movement callback');
  const state = actor.blastReaction;
  if (!state || dt === 0) return false;
  const before = smooth(0, BLAST_REACTION.fall, state.elapsed);
  state.elapsed = Math.min(BLAST_REACTION.duration, state.elapsed + dt);
  const distance = state.push * (smooth(0, BLAST_REACTION.fall, state.elapsed) - before);
  if (distance) move(state.direction.x * distance, state.direction.z * distance);
  if (state.elapsed >= BLAST_REACTION.duration && !state.lethal) {
    actor.stance = state.returnStance; actor.blastReaction = null;
  }
  return true;
}

export function blastCasualty(actor) {
  const sample = sampleBlastReaction(actor);
  if (!sample) return null;
  const state = actor.blastReaction;
  // The casualty solver supplies ground contact; reverse only the fall envelope,
  // with a separate roll, bracing and knee-drive recovery rather than reverse playback.
  return { ...state.casualty, time: -sample.progress, duration: 1,
    yaw: state.casualty.yaw, blastRoll: sample.rolled * .35,
    recovery: sample.recovery, motion: { ...state.casualty.motion, weight: 0, speed: 0,
      footContacts: null, headAim: null, rifleOperation: null, dadao: null, bayonet: null,
      turn: { weight: 0, phase: 0, direction: 1 } } };
}
