const eventTypes = new Set(['control.changed', 'vehicle.exited', 'vehicle.entered', 'death.started', 'death.completed', 'weapon.reload-requested', 'equipment.changed']);

export function createControlEvents() {
  const pending = [], history = [];
  let serial = 0;
  return {
    publish(type, data, time) {
      if (!eventTypes.has(type)) throw new RangeError(`Unknown control event: ${type}`);
      if (!Number.isFinite(time) || time < 0 || !data.soldierId) throw new Error('Control events require a source soldier and simulation time');
      if (pending.length >= 64) throw new Error('Control feedback queue exceeded its bounded capacity');
      const event = Object.freeze({ ...data, id: ++serial, type, time });
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
