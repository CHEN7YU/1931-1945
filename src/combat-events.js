import { EXPLOSION_STYLES } from './combat-particles.js';

export const COMBAT_EVENT_LIMIT = 1024;
export const COMBAT_HISTORY_LIMIT = 64;

const point = value => {
  if (!value || !['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]))) throw new RangeError('Combat feedback positions must be finite');
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
};
const copySource = value => {
  if (value?.credit === 'environment' && ['boundary', 'fall'].includes(value.cause) && typeof value.subjectId === 'string' && value.subjectId) {
    return Object.freeze({ credit: 'environment', cause: value.cause, subjectId: value.subjectId });
  }
  if (value?.credit === 'environment' && ['crash', 'tank-crush'].includes(value.cause) && typeof value.vehicleId === 'string' && value.vehicleId) {
    return Object.freeze({ credit: 'environment', cause: value.cause, vehicleId: value.vehicleId });
  }
  if (!value || !['player', 'ally', 'enemy'].includes(value.credit) ||
    !['unitId', 'soldierId', 'weaponId'].every(field => typeof value[field] === 'string' && value[field]) ||
    value.team !== (value.credit === 'enemy' ? 'enemy' : 'friendly') ||
    !['vehicleId', 'seatId'].every(field => value[field] == null || typeof value[field] === 'string')) throw new Error('Combat feedback requires an original attack source');
  const classification = {};
  if (value.cause === 'tank-crush') classification.cause = value.cause;
  if (value.weaponClass != null) {
    if (!['weaponClass', 'squadId', 'unitName'].every(field => typeof value[field] === 'string' && value[field])) throw new Error('Attack classification requires immutable weapon and squad labels');
    for (const field of ['weaponClass', 'squadId', 'unitName']) classification[field] = value[field];
  }
  return Object.freeze({ credit: value.credit, team: value.team, unitId: value.unitId, soldierId: value.soldierId,
    ...classification,
    weaponId: value.weaponId, vehicleId: value.vehicleId ?? null, seatId: value.seatId ?? null });
};
const copyTarget = value => {
  if (!value || !['soldier', 'vehicle', 'emplacement'].includes(value.kind) ||
    !['id', 'unitId'].every(field => typeof value[field] === 'string' && value[field]) ||
    !['friendly', 'enemy'].includes(value.team)) throw new Error('Combat feedback requires a target identity');
  return Object.freeze({ kind: value.kind, id: value.id, unitId: value.unitId, team: value.team });
};
const freshCounts = () => ({ shot: 0, impact: 0, explosion: 0, damage: 0, casualty: 0 });

export function createCombatEvents() {
  const pending = [], history = [];
  let serial = 0, published = freshCounts(), presented = freshCounts();
  return {
    publish(type, data, time) {
      if (!Object.hasOwn(published, type)) throw new RangeError(`Unknown combat feedback: ${type}`);
      if (!Number.isFinite(time) || time < 0) throw new RangeError('Combat feedback requires simulation time');
      if (pending.length >= COMBAT_EVENT_LIMIT) throw new Error('Combat feedback exceeded its bounded capacity');
      const source = copySource(data?.source);
      let payload;
      if (type === 'shot') {
        const { weaponType, muzzle = false, color = 0xffd49a, sound = null, recoil = 0, automatic = false } = data;
        if (source.credit === 'environment' || !['infantry', 'tank', 'mortar', 'plane'].includes(weaponType) ||
          typeof muzzle !== 'boolean' || typeof automatic !== 'boolean' || automatic && !['infantry', 'plane'].includes(weaponType) ||
          !Number.isInteger(color) || color < 0 || color > 0xffffff ||
          ![null, 'shot', 'blast'].includes(sound) || !Number.isFinite(recoil) || recoil < 0) throw new RangeError('Invalid shot feedback');
        payload = { source, weaponType, start: point(data.start), end: data.end == null ? null : point(data.end), muzzle, color, sound, recoil };
        if (automatic) payload.automatic = true;
        if (muzzle && !payload.end) throw new Error('Muzzle feedback requires a shot direction');
      } else if (type === 'impact') {
        const kind = data.kind ?? null;
        if (![null, 'stone', 'soil', 'wood', 'generic'].includes(kind)) throw new RangeError('Invalid impact material');
        payload = { source, position: point(data.position), kind, normal: kind ? point(data.normal) : null };
      } else if (type === 'explosion') {
        if (typeof data.sound !== 'boolean') throw new RangeError('Explosion feedback requires an explicit sound policy');
        if (data.radius != null && (!Number.isFinite(data.radius) || data.radius <= 0)) throw new RangeError('Explosion radius must be positive');
        const style = data.style ?? 'default';
        if (!EXPLOSION_STYLES.includes(style)) throw new RangeError('Invalid explosion style');
        payload = { source, position: point(data.position), sound: data.sound, radius: data.radius ?? 7, style };
        if (data.surface != null) {
          if (!['stone', 'soil', 'wood', 'generic'].includes(data.surface.kind) ||
            !data.surface.normal || Math.hypot(data.surface.normal.x, data.surface.normal.y, data.surface.normal.z) < .001) throw new RangeError('Invalid explosion surface');
          payload.surface = Object.freeze({ kind: data.surface.kind, normal: point(data.surface.normal) });
        }
      } else if (type === 'damage') {
        if (!Number.isFinite(data.amount) || data.amount <= 0 || !Number.isFinite(data.health) || data.health < 0 ||
          (data.observerId != null && (typeof data.observerId !== 'string' || !data.observerId))) throw new RangeError('Invalid applied damage feedback');
        payload = { source, target: copyTarget(data.target), amount: data.amount, health: data.health, observerId: data.observerId ?? null };
        if (data.hitZone != null) {
          if (payload.target.kind !== 'soldier' || !['head', 'torso', 'limb'].includes(data.hitZone)) throw new RangeError('Invalid anatomical damage feedback');
          payload.hitZone = data.hitZone;
        }
      } else {
        const target = copyTarget(data.target);
        if (target.kind !== 'soldier' || data.health !== 0) throw new Error('Casualty feedback requires a confirmed dead soldier');
        payload = { source, target, health: 0 };
      }
      const event = Object.freeze({ ...payload, id: ++serial, type, time });
      pending.push(event); history.push(event); published[type]++;
      if (history.length > COMBAT_HISTORY_LIMIT) history.shift();
      return event;
    },
    drain(consume) {
      if (!pending.length) return 0;
      const batch = pending.splice(0);
      for (const event of batch) { consume(event); presented[event.type]++; }
      return batch.length;
    },
    clear() { pending.length = history.length = 0; serial = 0; published = freshCounts(); presented = freshCounts(); },
    get snapshot() { return { pending: pending.length, published: { ...published }, presented: { ...presented }, history: [...history] }; },
  };
}
