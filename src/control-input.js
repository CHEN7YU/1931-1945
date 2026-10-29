const actions = new Set(['interact', 'reload', 'cycleMember', 'equipRifle', 'equipTool', 'crouch', 'prone',
  'jump', 'startOrder', 'finishOrder', 'look', 'pressFire', 'pressAim', 'equipGrenade', 'equipExplosivePack', 'prepareGrenade', 'releaseGrenade',
  'equipMelee', 'equipSidearm', 'equipSpecial', 'callArtillery']);
const ownerFields = ['unitId', 'soldierId', 'vehicleId', 'seatId', 'weaponId'];
const sameOwner = (a, b) => Boolean(a && b && ownerFields.every(field => a[field] === b[field]));

export function createControlInput() {
  const keys = new Set(), held = { primary: false, secondary: false, aiming: false, orderStarted: null };
  const issued = new WeakSet(), consumed = new WeakSet(), decisions = [];
  let owner = null, revision = 0, serial = 0, enabled = false;
  const clearHeld = () => {
    keys.clear();
    Object.assign(held, { primary: false, secondary: false, aiming: false, orderStarted: null });
  };
  const record = (command, status, reason = null) => {
    const result = { id: command.id, action: command.action, revision: command.revision, soldierId: command.owner?.soldierId || null, status, reason };
    decisions.push(result);
    if (decisions.length > 32) decisions.shift();
    return result;
  };
  return {
    keys, held, clearHeld,
    bind(nextOwner, allowInput = true) {
      if (!nextOwner?.unitId || !nextOwner.soldierId || !nextOwner.weaponId) throw new Error('Controlled input requires unit, soldier and weapon identities');
      const next = Object.freeze(Object.fromEntries(ownerFields.map(field => [field, nextOwner[field] ?? null])));
      const changed = !sameOwner(owner, next);
      owner = next;
      enabled = allowInput; revision++; clearHeld();
      return changed;
    },
    block() { enabled = false; revision++; clearHeld(); },
    reset() { owner = null; enabled = false; revision++; clearHeld(); decisions.length = 0; },
    capture(action, payload = {}) {
      if (!actions.has(action)) throw new RangeError(`Unknown control action: ${action}`);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RangeError('Control command payload must be an object');
      if (action === 'look' && (!Number.isFinite(payload.x) || !Number.isFinite(payload.y))) throw new RangeError('Look command requires finite movement');
      if (['startOrder', 'finishOrder'].includes(action) && !Number.isFinite(payload.now)) throw new RangeError('Order command requires a finite input timestamp');
      const command = Object.freeze({ id: ++serial, action, payload: Object.freeze({ ...payload }), owner, revision });
      issued.add(command);
      return command;
    },
    execute(command, currentOwner, playing, perform) {
      if (!issued.has(command)) throw new Error('Control command did not originate from this input source');
      if (consumed.has(command)) return record(command, 'rejected', 'duplicate');
      consumed.add(command);
      if (!enabled || !playing) return record(command, 'rejected', 'inactive');
      if (command.revision !== revision || !sameOwner(command.owner, owner) || !sameOwner(command.owner, currentOwner)) return record(command, 'rejected', 'stale-owner');
      perform(command);
      return record(command, 'applied');
    },
    get snapshot() { return { owner: owner ? { ...owner } : null, revision, enabled, keys: [...keys], held: { ...held },
      decisions: decisions.map(decision => ({ ...decision })) }; },
  };
}
// ---模块结束---
