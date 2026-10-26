const eventTypes = new Set(['control.changed', 'vehicle.exited', 'vehicle.entered', 'death.started', 'death.completed', 'weapon.reload-requested', 'weapon.mechanical', 'equipment.changed', 'movement.footstep', 'door.requested', 'construction.notice', 'rally.destroyed']);
const worldEvents = new Set(['door.requested', 'rally.destroyed']);
const mechanicalCues = new Set(['unlock', 'extract', 'load', 'close']);
const copyPosition = value => {
  if (!value || !['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]))) throw new RangeError('Feedback requires a finite world position');
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
};

export function createControlEvents() {
  const pending = [], history = [];
  let serial = 0;
  return {
    publish(type, data, time) {
      if (!eventTypes.has(type)) throw new RangeError(`Unknown control event: ${type}`);
      if (!Number.isFinite(time) || time < 0 || (!worldEvents.has(type) && !data?.soldierId)) throw new Error('Control events require a source soldier and simulation time');
      if (type === 'weapon.mechanical' && (!data.weaponId || !mechanicalCues.has(data.cue))) throw new Error('Mechanical feedback requires a weapon identity and valid cue');
      if (pending.length >= 64) throw new Error('Control feedback queue exceeded its bounded capacity');
      let payload = data;
      if (type === 'movement.footstep') {
        if (!['unitId', 'soldierId'].every(field => typeof data[field] === 'string' && data[field]) ||
          !['stone', 'wood', 'earth'].includes(data.surface) || !['standing', 'crouched', 'prone'].includes(data.stance) ||
          !Number.isFinite(data.speed) || data.speed < 0 || typeof data.landing !== 'boolean') throw new Error('Invalid footstep feedback');
        payload = { unitId: data.unitId, soldierId: data.soldierId, position: copyPosition(data.position),
          surface: data.surface, stance: data.stance, speed: data.speed, landing: data.landing };
      } else if (type === 'door.requested') {
        if (typeof data?.doorId !== 'string' || !data.doorId || typeof data.opening !== 'boolean') throw new Error('Door feedback requires a door identity and requested direction');
        payload = { doorId: data.doorId, position: copyPosition(data.position), opening: data.opening };
      } else if (type === 'rally.destroyed') {
        if (!data || !['rallyId', 'builderId'].every(field => typeof data[field] === 'string' && data[field]) ||
          !['friendly', 'enemy'].includes(data.team)) throw new Error('Rally feedback requires its world identity and team');
        payload = { rallyId: data.rallyId, builderId: data.builderId, team: data.team, position: copyPosition(data.position) };
      } else if (type === 'construction.notice') {
        if (!['completed', 'moved', 'owner-changed', 'unavailable'].includes(data.reason) ||
          !['unitId', 'soldierId'].every(field => typeof data[field] === 'string' && data[field]) ||
          (data.reason === 'completed' && (typeof data.rallyId !== 'string' || !data.rallyId))) throw new Error('Invalid construction feedback');
        payload = { unitId: data.unitId, soldierId: data.soldierId, reason: data.reason,
          rallyId: data.reason === 'completed' ? data.rallyId : null,
          position: data.reason === 'completed' ? copyPosition(data.position) : null };
      }
      const event = Object.freeze({ ...payload, id: ++serial, type, time });
      pending.push(event);
      history.push(event);
      if (history.length > 64) history.shift();
      return event;
    },
    drain(consume) {
      if (!pending.length) return 0;
      const batch = pending.splice(0);
      for (const event of batch) consume(event);
      return batch.length;
    },
    clear() { pending.length = history.length = 0; serial = 0; },
    get snapshot() { return { pending: pending.length, history: history.map(event => ({ ...event })) }; },
  };
}
// ---模块结束---
