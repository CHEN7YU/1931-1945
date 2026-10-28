// Prototype balance values, not verified Enlisted or historical weapon specifications.
export const GRENADE = Object.freeze({ count: 2, fuse: 4, draw: .45, windup: .22, recovery: .4,
  autoThrowRemaining: .65, speed: 15, lift: 2.2, gravity: 9.81, bounce: .32, friction: .65,
  size: .065, radius: 7, damage: 180, pickup: 2, limit: 32, step: 1 / 120 });

const finiteTime = time => {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Grenades require finite non-negative simulation time');
};
const point = value => {
  if (!value || !['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]))) throw new RangeError('Grenade vectors must be finite');
  return { x: value.x, y: value.y, z: value.z };
};
const sourceCopy = source => {
  if (!source || !['soldierId', 'unitId', 'weaponId'].every(key => typeof source[key] === 'string' && source[key]) ||
    !['player', 'ally', 'enemy'].includes(source.credit) ||
    source.team !== (source.credit === 'enemy' ? 'enemy' : 'friendly')) throw new Error('Grenade requires an original attack source');
  return Object.freeze({ ...source });
};

export function createGrenadeInventory() { return { ammo: GRENADE.count, action: null }; }

export function grenadeCanDamage(source, target) {
  return target.targetKind !== 'closed-armor' && target.targetKind !== 'aircraft' &&
    (target.team !== source.team || target.id === source.soldierId);
}

export function grenadePose(action, eyeHeight = 1.67) {
  if (!action) return null;
  const progress = action.phase === 'drawing' ? Math.min(1, action.elapsed / GRENADE.draw)
    : action.phase === 'throwing' ? Math.min(1, action.elapsed / GRENADE.windup)
    : action.phase === 'recovering' ? Math.max(0, 1 - action.elapsed / GRENADE.recovery) : 1;
  const throwing = action.phase === 'throwing', returning = action.phase === 'recovering';
  const y = eyeHeight - .15;
  return { phase: action.phase, progress, visible: !returning,
    hand: throwing ? [.32, y + .14 * progress, .02 - .44 * progress]
      : [.32, y - .35 * (1 - progress), .02],
    position: throwing ? [.32, y + .14 * progress, -.04 - .44 * progress]
      : [.32, y - .35 * (1 - progress), -.04] };
}

export function advanceGrenadeFlight(grenade, dt, trace) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid grenade flight timestep');
  for (let remaining = dt; remaining > 1e-9;) {
    const step = Math.min(remaining, GRENADE.step);
    remaining -= step;
    if (grenade.resting) {
      const support = trace(grenade.position, { ...grenade.position, y: grenade.position.y - .005 }, GRENADE.size);
      if (support && support.normal.y > .6) continue;
      grenade.resting = false;
    }
    const from = point(grenade.position), to = {};
    for (const axis of ['x', 'y', 'z']) to[axis] = from[axis] + grenade.velocity[axis] * step;
    to.y -= .5 * GRENADE.gravity * step * step;
    grenade.velocity.y -= GRENADE.gravity * step;
    const hit = trace(from, to, GRENADE.size);
    if (!hit) { grenade.position = to; continue; }
    const normal = point(hit.normal), length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 1e-8) throw new RangeError('Grenade collision requires a nonzero normal');
    for (const axis of ['x', 'y', 'z']) normal[axis] /= length;
    grenade.position = point(hit.position);
    const incoming = ['x', 'y', 'z'].reduce((sum, axis) => sum + grenade.velocity[axis] * normal[axis], 0);
    for (const axis of ['x', 'y', 'z']) {
      const tangent = grenade.velocity[axis] - incoming * normal[axis];
      grenade.velocity[axis] = tangent * GRENADE.friction - Math.min(0, incoming) * normal[axis] * GRENADE.bounce;
      grenade.position[axis] += normal[axis] * .001;
    }
    if (normal.y > .6 && Math.hypot(grenade.velocity.x, grenade.velocity.y, grenade.velocity.z) < .35) {
      grenade.velocity = { x: 0, y: 0, z: 0 };
      grenade.resting = true;
    }
    grenade.collisions++;
  }
}

export function createGrenadeSystem() {
  const active = new Map(), inventories = new Map(), history = [];
  let serial = 0;
  const remember = event => { history.push(Object.freeze(event)); if (history.length > 32) history.shift(); };
  const inventoryFor = (id, inventory) => {
    if (!id || !Number.isInteger(inventory?.ammo) || inventory.ammo < 0 || inventory.ammo > GRENADE.count) {
      throw new Error('Grenade inventory requires a soldier identity and bounded count');
    }
    inventories.set(id, inventory);
    return inventory;
  };
  const recover = (grenade, now) => {
    const inventory = inventories.get(grenade.holderId);
    if (inventory?.action === grenade) inventory.action = { phase: 'recovering', elapsed: 0, startedAt: now };
    grenade.holderId = null;
  };
  return {
    begin(id, inventory, source, now) {
      finiteTime(now); inventoryFor(id, inventory);
      if (inventory.action) return '正在操作手榴弹';
      if (!inventory.ammo) return '这名士兵的手榴弹已用完';
      if (active.size >= GRENADE.limit) return '场上手榴弹已达上限，请稍候';
      const captured = sourceCopy(source);
      if (captured.soldierId !== id) throw new Error('Grenade source must own its inventory');
      const grenade = { id: `grenade-${++serial}`, source: captured, originalSource: captured, holderId: id,
        phase: 'drawing', elapsed: 0, startedAt: now, pinAt: now + GRENADE.draw, detonateAt: null, throwAt: null, releaseRequested: false,
        position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, collisions: 0, throws: 0 };
      active.set(grenade.id, grenade); inventory.action = grenade;
      return null;
    },
    release(id, now) {
      finiteTime(now);
      const action = inventories.get(id)?.action;
      if (!action || !['drawing', 'cooking'].includes(action.phase) || action.releaseRequested) return false;
      action.throwAt = Math.max(action.pinAt, now) + GRENADE.windup;
      action.releaseRequested = true;
      return true;
    },
    interrupt(id) {
      const inventory = inventories.get(id), action = inventory?.action;
      if (!action) return;
      inventory.action = null;
      if (action.phase === 'recovering') return;
      action.holderId = null;
      if (action.detonateAt === null) active.delete(action.id);
      else { action.phase = 'flight'; action.throwAt = null; action.resting = false; action.velocity = { x: 0, y: 0, z: 0 }; }
    },
    forget(id) { this.interrupt(id); inventories.delete(id); },
    rethrow(grenadeId, id, inventory, source, now) {
      finiteTime(now); inventoryFor(id, inventory);
      const grenade = active.get(grenadeId);
      if (!grenade || grenade.phase !== 'flight' || grenade.detonateAt <= now) return '手榴弹已无法回掷';
      if (inventory.action) return '先完成当前投掷动作';
      const captured = sourceCopy(source);
      if (captured.soldierId !== id) throw new Error('Throwback source must own its inventory');
      Object.assign(grenade, { holderId: id, source: captured, phase: 'throwing', startedAt: now,
        pinAt: null, throwAt: now + GRENADE.windup, elapsed: 0, resting: false, releaseRequested: true });
      inventory.action = grenade;
      return null;
    },
    advance(now, dt, { pose, trace, explode, primed = () => {} }) {
      finiteTime(now);
      if (!Number.isFinite(dt) || dt < 0 || dt > now + 1e-8) throw new RangeError('Invalid grenade simulation step');
      if (dt === 0) return;
      for (const inventory of inventories.values()) {
        const action = inventory.action;
        if (action?.phase === 'recovering') {
          action.elapsed = now - action.startedAt;
          if (action.elapsed >= GRENADE.recovery) inventory.action = null;
        }
      }
      for (const grenade of [...active.values()]) {
        if (grenade.holderId) {
          if (grenade.detonateAt === null && now >= grenade.pinAt) {
            const inventory = inventories.get(grenade.holderId);
            if (!inventory?.ammo) throw new Error('Priming requires a remaining personal grenade');
            inventory.ammo--;
            grenade.detonateAt = grenade.pinAt + GRENADE.fuse;
            grenade.phase = 'cooking';
            primed(grenade);
          }
          if (grenade.detonateAt !== null) {
            if (grenade.pinAt !== null) grenade.throwAt = Math.min(grenade.throwAt ?? Infinity, grenade.detonateAt - GRENADE.autoThrowRemaining);
            const throwing = now >= grenade.throwAt - GRENADE.windup;
            grenade.phase = throwing ? 'throwing' : 'cooking';
            grenade.elapsed = now - (throwing ? grenade.throwAt - GRENADE.windup : grenade.pinAt);
          } else grenade.elapsed = now - grenade.startedAt;
          const held = pose(grenade.holderId, grenade);
          grenade.position = point(held.position);
          // A late throwback can still detonate in the holder's hand.
          if (grenade.detonateAt !== null && now >= grenade.detonateAt) {
            recover(grenade, now);
          } else if (grenade.throwAt !== null && now >= grenade.throwAt && grenade.detonateAt !== null) {
            const direction = point(held.direction), length = Math.hypot(direction.x, direction.y, direction.z);
            if (length < 1e-8) throw new RangeError('Throwing requires an aim direction');
            grenade.velocity = { x: direction.x / length * GRENADE.speed, y: direction.y / length * GRENADE.speed + GRENADE.lift,
              z: direction.z / length * GRENADE.speed };
            const thrownAt = grenade.throwAt;
            recover(grenade, thrownAt);
            grenade.phase = 'flight'; grenade.throws++;
            remember({ type: 'throw', id: grenade.id, source: grenade.source, time: thrownAt });
          }
        }
        if (grenade.phase === 'flight') {
          const flightStart = Math.max(now - dt, grenade.throwAt ?? now - dt);
          const flightEnd = Math.min(now, grenade.detonateAt);
          advanceGrenadeFlight(grenade, Math.max(0, flightEnd - flightStart), trace);
        }
        if (grenade.detonateAt !== null && now >= grenade.detonateAt) {
          active.delete(grenade.id);
          const event = { type: 'explosion', id: grenade.id, source: grenade.source, originalSource: grenade.originalSource,
            position: point(grenade.position), time: grenade.detonateAt, collisions: grenade.collisions, throws: grenade.throws };
          remember(event); explode(event);
        }
      }
    },
    clear() {
      for (const inventory of inventories.values()) inventory.action = null;
      active.clear(); inventories.clear(); history.length = 0; serial = 0;
    },
    get active() { return [...active.values()]; },
    get history() { return [...history]; },
  };
}
