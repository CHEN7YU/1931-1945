export const FATAL_FALL_SECONDS = 4;

export function beginFatalFall(actor, damage, now, controlled) {
  if (![damage, now, actor.health].every(Number.isFinite) || damage < 0 || now < 0)
    throw new RangeError('Fatal fall requires finite damage, health and simulation time');
  if (!controlled || actor.health <= 0 || actor.fatalFall || damage < actor.health) return false;
  actor.fatalFall = { deadline: now + FATAL_FALL_SECONDS, throwStarted: false };
  if (actor.rifle) cancelRifleReload(actor.rifle);
  return true;
}

export function fatalFallExpired(actor, now) {
  return Boolean(actor.fatalFall && now >= actor.fatalFall.deadline);
}

export function fatalFallActionAllowed(actor, action) {
  return !actor.fatalFall || ['look', 'equipGrenade', 'equipExplosivePack', 'pressFire',
    'releaseGrenade'].includes(action);
}
import { cancelRifleReload } from './rifle-action.js';
