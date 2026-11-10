export const DYING_SECONDS = 1.5;
const allowed = new Set(['look', 'pressAim', 'equipRifle', 'equipGrenade', 'equipExplosivePack',
  'pressFire', 'prepareGrenade', 'releaseGrenade']);

export function beginDying(actor, now, source) {
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(actor.health))
    throw new RangeError('Dying requires a finite simulation clock and health');
  if (actor.dying || actor.health <= 0 || actor.vehicleId) return false;
  actor.dying = { startedAt: now, deadline: now + DYING_SECONDS,
    action: actor.grenades?.action ? 'throw' : null,
    source: source && typeof source === 'object' ? { ...source } : source };
  if (actor.rifle) cancelRifleReload(actor.rifle);
  return true;
}

export function lastStandThrowable(actor, preferred = 'grenade') {
  throwableProfile(preferred);
  if (actor.grenades.action) return null;
  const alternate = preferred === 'grenade' ? 'explosive-pack' : 'grenade';
  return [preferred, alternate].find(kind => throwableStock(actor.grenades, kind) > 0) ?? null;
}

export function dyingExpired(actor, now) {
  return Boolean(actor.dying && now >= actor.dying.deadline);
}

export function dyingActionAllowed(actor, action) {
  return !actor.dying || allowed.has(action);
}

export function dyingMask(actor, now) {
  if (!actor?.dying) return null;
  const progress = Math.max(0, Math.min(1, (now - actor.dying.startedAt) / DYING_SECONDS));
  return { progress, dark: .85 * progress * progress, red: .2 + progress * .45 };
}
import { cancelRifleReload } from './rifle-action.js';
import { throwableStock, throwableProfile } from './grenades.js';
