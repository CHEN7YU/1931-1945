import { BAYONET, closeCombatDistance } from './bayonet.js';
import { DADAO, drawDadao, stowDadao, startDadaoSwing, advanceDadao, selectDadaoTarget } from './dadao.js';

export function dadaoCombatDistance(actor, target) {
  return closeCombatDistance(actor, target, actor.team === 'friendly' && Boolean(actor.dadao), .6);
}

export function advanceAIDadao(actor, target, { now, visible, facing, settled, origin, forward, aimPoint, clear }) {
  if (!Number.isFinite(now) || now < 0 || ![visible, facing, settled].every(value => typeof value === 'boolean')) {
    throw new RangeError('Dadao combat requires explicit time, sight, facing and posture facts');
  }
  const state = actor.dadao, distance = dadaoCombatDistance(actor, target);
  const continuing = state?.targetId === target?.id && state?.mode !== 'idle';
  if (distance === null || distance > (continuing ? BAYONET.disengageRange : BAYONET.chargeRange) || !visible) {
    if (state) stowDadao(state);
    return { active: false, hit: false };
  }
  if (!continuing) { stowDadao(state); state.targetId = target.id; }
  drawDadao(state, now);
  advanceDadao(state, now);
  if (distance <= DADAO.reach && facing && settled &&
    startDadaoSwing(state, now, actor.locomotion.stamina)) {
    actor.locomotion.stamina = Math.max(0, actor.locomotion.stamina - DADAO.stamina);
  }
  state.pose = advanceDadao(state, now);
  state.mode = state.startedAt !== null ? state.pose.phase : now < state.readyAt ? 'draw'
    : distance > DADAO.reach ? 'charge' : 'ready';
  const hit = facing && settled && selectDadaoTarget(state, now, actor, origin, forward,
    [target], aimPoint, clear) === target;
  if (hit) { state.connected = true; state.hits++; }
  return { active: true, hit: Boolean(hit) };
}
