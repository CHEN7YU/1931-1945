// Prototype balance values, not verified Enlisted or historical weapon specifications.
import { blastDamage } from './core.js';
export const GRENADE = Object.freeze({ count: 1, fuse: 4, draw: .45, windup: .22, recovery: .4,
  autoThrowRemaining: .65, speed: 15, lift: 2.2, gravity: 9.81, bounce: .32, friction: .65,
  size: .065, radius: 7, damage: 180, limit: 32, step: 1 / 120 });
export const EXPLOSIVE_PACK = Object.freeze({ ...GRENADE, fuse: 5, draw: .6, windup: .3, recovery: .5,
  speed: 11, lift: 2.4, bounce: .18, friction: .5, size: .18, radius: 9, damage: 240,
  armorRadius: 4, armorDamage: 720 });
const restingSupports = new WeakMap();
export function throwableProfile(kind = 'grenade') {
  if (!['grenade', 'explosive-pack'].includes(kind)) throw new RangeError(`Unknown throwable: ${kind}`);
  return kind === 'grenade' ? GRENADE : EXPLOSIVE_PACK;
}
export function throwableStock(inventory, kind = 'grenade') {
  const profile = throwableProfile(kind), value = inventory?.[kind === 'grenade' ? 'ammo' : 'packs'];
  if (!Number.isInteger(value) || value < 0 || value > profile.count) throw new RangeError('Invalid owned throwable stock');
  return value;
}

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

export function createGrenadeInventory() { return { ammo: GRENADE.count, packs: EXPLOSIVE_PACK.count, action: null }; }

export function grenadeCanDamage(source, target, kind = 'grenade') {
  throwableProfile(kind);
  return (kind === 'explosive-pack' || target.targetKind !== 'closed-armor' && target.targetKind !== 'aircraft') &&
    (target.team !== source.team || target.id === source.soldierId);
}

export function throwableVehicleDamage(kind, source, vehicle, position, clear) {
  const profile = throwableProfile(kind);
  if (!['tank', 'plane'].includes(vehicle?.type) || !Number.isFinite(vehicle.health) ||
    typeof clear !== 'function') throw new RangeError('Throwable vehicle damage requires an actual vehicle, blast position and visibility query');
  point(vehicle.position); point(position);
  if (kind === 'grenade' || vehicle.health <= 0 || vehicle.team === source.team) return 0;
  const target = { x: vehicle.position.x, y: vehicle.position.y + 1, z: vehicle.position.z };
  const origin = { ...position, y: Math.max(position.y, .5) };
  const distance = Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z);
  if (distance >= profile.armorRadius) return 0;
  const visible = clear(origin, target, profile.armorRadius + 1);
  if (typeof visible !== 'boolean') throw new TypeError('Blast visibility must be explicit');
  return visible ? blastDamage(distance, profile.armorRadius, profile.armorDamage) : 0;
}

export function grenadePose(action, eyeHeight = 1.67) {
  if (!action) return null;
  const profile = throwableProfile(action.kind), pack = action.kind === 'explosive-pack', phase = action.phase;
  const t = Math.max(0, Math.min(1, (action.elapsed ?? 0) /
    (phase === 'drawing' ? profile.draw : phase === 'throwing' ? profile.windup : profile.recovery)));
  const smooth = value => { const p = Math.max(0, Math.min(1, value)); return p * p * (3 - 2 * p); };
  const lerp = (a, b, weight) => a.map((value, index) => value + (b[index] - value) * weight);
  const pose = (wrist, forward, palm, pole, opening = 0) => ({ wrist, forward, palm, pole, opening });
  const blend = (a, b, weight) => ({
    ...Object.fromEntries(['wrist', 'forward', 'palm', 'pole'].map(key => [key, lerp(a[key], b[key], weight)])),
    opening: a.opening + (b.opening - a.opening) * weight,
  });
  const restForward = [-.1, .9, -.42], restPalm = [-.85, -.29, -.44], lowElbow = [.8, -.65, .25];
  const idle = pose([.18, -.30, -.36], restForward, restPalm, lowElbow);
  const hold = pose(pack ? [.16, -.28, -.36] : [.16, -.25, -.38], restForward, restPalm, lowElbow);
  const lift = pose(pack ? [.44, -.06, -.02] : [.42, -.04, -.05], [.15, .9, .4], [.7, -.5, -.4], [.9, .45, .1]);
  const loaded = pose(pack ? [.40, .04, .12] : [.35, .08, .14], [0, .9, .42], [.8, -.35, .2], [.9, .45, .1]);
  const release = pose(pack ? [.40, .025, -.28] : [.39, .06, -.28], [-.15, .2, -.97], [.55, -.8, -.25], [.9, .2, .1], .58);
  const follow = pose([.43, -.12, -.25], [-.15, -.15, -.97], [.75, -.5, -.3], [.9, -.3, .15], .52);
  const withdrawn = pose([.35, -.40, -.13], [-.1, -.35, -.93], [.9, -.35, -.25], lowElbow, .45);
  const stow = pose([.32, -.61, -.02], [-.1, -.65, -.75], [.95, -.1, -.28], lowElbow, .45);
  const loadAt = pack ? .66 : .60, liftAt = pack ? .49 : .46;
  let view = idle, preparation = 0, guiding = 0, releaseWeight = 0;
  if (phase === 'drawing') {
    view = t < .36 ? blend(idle, hold, smooth(t / .36))
      : t < loadAt ? blend(hold, lift, smooth((t - .36) / (loadAt - .36)))
      : blend(lift, loaded, smooth((t - loadAt) / (1 - loadAt)));
    preparation = smooth(t / .18) * (1 - smooth((t - .36) / .12));
    guiding = smooth((t - liftAt) / (.80 - liftAt));
  } else if (phase === 'cooking') { view = loaded; guiding = 1; }
  else if (phase === 'throwing') {
    releaseWeight = t ** (pack ? 2.4 : 2);
    view = blend(loaded, release, releaseWeight);
    guiding = 1 - smooth((t - .12) / .65);
    view.opening = .58 * smooth((t - .94) / .06);
  } else if (phase === 'recovering') {
    view = t < .18 ? blend(release, follow, smooth(t / .18))
      : t < .48 ? blend(follow, withdrawn, smooth((t - .18) / .30))
      : blend(withdrawn, stow, smooth((t - .48) / .52));
    releaseWeight = 1 - smooth(t);
  }
  const guide = { wrist: [-.16, -.22, -.40], forward: [.2, .7, -.68], palm: [-.1, .7, .69],
    palmSide: -1, pole: [-.8, -.45, .2], closure: .60 };
  view = { ...view, preparation, guiding, guide,
    pull: phase === 'drawing' ? smooth((t - .25) / .10) : phase === 'idle' ? 0 : 1 };
  // Keep the historical terminal launch point; the wrist stays behind it by a real hand's reach.
  const hand = lerp(view.wrist, [
    view.wrist[0] + .32 - release.wrist[0], view.wrist[1] - .08 - release.wrist[1],
    view.wrist[2] - .34 - release.wrist[2],
  ], releaseWeight);
  const prone = Math.max(0, Math.min(1, (.85 - eyeHeight) / .40));
  hand[1] = Math.max(.10, hand[1] + eyeHeight - .10 * prone * (1 - releaseWeight));
  hand[2] -= .28 * prone * (1 - releaseWeight);
  const pole = lerp(view.pole, [view.pole[0], Math.max(.45, view.pole[1]), view.pole[2]], prone);
  const guideHand = [guide.wrist[0], Math.max(.10, guide.wrist[1] + eyeHeight), guide.wrist[2] - .28 * prone];
  const guidePole = lerp(guide.pole, [guide.pole[0], .45, guide.pole[2]], prone);
  return { phase, progress: phase === 'recovering' ? 1 - t : ['drawing', 'throwing'].includes(phase) ? t : 1,
    visible: phase !== 'recovering', hand, pole, guideHand, guidePole,
    position: [hand[0], hand[1] + .07, hand[2] - .14], view };
}

export function advanceGrenadeFlight(grenade, dt, trace) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid grenade flight timestep');
  const profile = throwableProfile(grenade.kind);
  if (dt === 0) return;
  const cached = restingSupports.get(grenade);
  if (cached) {
    const unchanged = grenade.resting && cached.trace === trace && cached.kind === grenade.kind &&
      ['x', 'y', 'z'].every(axis => grenade.position[axis] === cached.position[axis] && grenade.velocity[axis] === 0);
    if (unchanged) {
      const valid = cached.valid();
      if (typeof valid !== 'boolean') throw new TypeError('Static grenade support validity must be explicit');
      if (valid) return;
    }
    restingSupports.delete(grenade);
  }
  for (let remaining = dt; remaining > 1e-9;) {
    const step = Math.min(remaining, profile.step);
    remaining -= step;
    if (grenade.resting) {
      const support = trace(grenade.position, { ...grenade.position, y: grenade.position.y - .005 }, profile.size, true);
      if (support && support.normal.y > .6) {
        if (support.staticSupport != null) {
          if (typeof support.staticSupport !== 'function') throw new TypeError('Static grenade support needs a validity function');
          const valid = support.staticSupport();
          if (typeof valid !== 'boolean') throw new TypeError('Static grenade support validity must be explicit');
          if (valid && ['x', 'y', 'z'].every(axis => grenade.velocity[axis] === 0)) {
            restingSupports.set(grenade, { trace, kind: grenade.kind, position: point(grenade.position), valid: support.staticSupport });
            return;
          }
        }
        continue;
      }
      grenade.resting = false;
    }
    const from = point(grenade.position), to = {};
    for (const axis of ['x', 'y', 'z']) to[axis] = from[axis] + grenade.velocity[axis] * step;
    to.y -= .5 * profile.gravity * step * step;
    grenade.velocity.y -= profile.gravity * step;
    const hit = trace(from, to, profile.size);
    if (!hit) { grenade.position = to; continue; }
    const normal = point(hit.normal), length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 1e-8) throw new RangeError('Grenade collision requires a nonzero normal');
    for (const axis of ['x', 'y', 'z']) normal[axis] /= length;
    grenade.position = point(hit.position);
    const incoming = ['x', 'y', 'z'].reduce((sum, axis) => sum + grenade.velocity[axis] * normal[axis], 0);
    for (const axis of ['x', 'y', 'z']) {
      const tangent = grenade.velocity[axis] - incoming * normal[axis];
      grenade.velocity[axis] = tangent * profile.friction - Math.min(0, incoming) * normal[axis] * profile.bounce;
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
    if (!id || !Number.isInteger(inventory?.ammo) || inventory.ammo < 0 || inventory.ammo > GRENADE.count ||
      !Number.isInteger(inventory.packs) || inventory.packs < 0 || inventory.packs > EXPLOSIVE_PACK.count) {
      throw new Error('Grenade inventory requires a soldier identity and bounded count');
    }
    inventories.set(id, inventory);
    return inventory;
  };
  const recover = (grenade, now) => {
    const inventory = inventories.get(grenade.holderId);
    if (inventory?.action === grenade) inventory.action = { phase: 'recovering', kind: grenade.kind, elapsed: 0, startedAt: now };
    grenade.holderId = null;
  };
  return {
    begin(id, inventory, source, now, kind = 'grenade') {
      finiteTime(now); inventoryFor(id, inventory);
      const profile = throwableProfile(kind), field = kind === 'grenade' ? 'ammo' : 'packs';
      if (inventory.action) return '正在操作手榴弹';
      if (!inventory[field]) return kind === 'grenade' ? '这名士兵的手榴弹已用完' : '这名士兵的炸药包已用完';
      if (active.size >= GRENADE.limit) return '场上手榴弹已达上限，请稍候';
      const captured = sourceCopy(source);
      if (captured.soldierId !== id) throw new Error('Grenade source must own its inventory');
      const grenade = { id: `grenade-${++serial}`, kind, source: captured, originalSource: captured, holderId: id,
        phase: 'drawing', elapsed: 0, startedAt: now, pinAt: now + profile.draw, detonateAt: null, throwAt: null, releaseRequested: false,
        position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, collisions: 0, throws: 0 };
      active.set(grenade.id, grenade); inventory.action = grenade;
      return null;
    },
    release(id, now) {
      finiteTime(now);
      const action = inventories.get(id)?.action;
      if (!action || !['drawing', 'cooking'].includes(action.phase) || action.releaseRequested) return false;
      action.throwAt = Math.max(action.pinAt, now) + throwableProfile(action.kind).windup;
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
    advance(now, dt, { pose, trace, explode, primed = () => {} }) {
      finiteTime(now);
      if (!Number.isFinite(dt) || dt < 0 || dt > now + 1e-8) throw new RangeError('Invalid grenade simulation step');
      if (dt === 0) return;
      for (const inventory of inventories.values()) {
        const action = inventory.action;
        if (action?.phase === 'recovering') {
          action.elapsed = now - action.startedAt;
          if (action.elapsed >= throwableProfile(action.kind).recovery) inventory.action = null;
        }
      }
      for (const grenade of [...active.values()]) {
        const profile = throwableProfile(grenade.kind);
        if (grenade.holderId) {
          if (grenade.detonateAt === null && now >= grenade.pinAt) {
            const inventory = inventories.get(grenade.holderId);
            const field = grenade.kind === 'explosive-pack' ? 'packs' : 'ammo';
            if (!inventory?.[field]) throw new Error('Priming requires a remaining personal throwable');
            inventory[field]--;
            grenade.detonateAt = grenade.pinAt + profile.fuse;
            grenade.phase = 'cooking';
            primed(grenade);
          }
          if (grenade.detonateAt !== null) {
            if (grenade.pinAt !== null) grenade.throwAt = Math.min(grenade.throwAt ?? Infinity, grenade.detonateAt - profile.autoThrowRemaining);
            const throwing = now >= grenade.throwAt - profile.windup;
            grenade.phase = throwing ? 'throwing' : 'cooking';
            grenade.elapsed = now - (throwing ? grenade.throwAt - profile.windup : grenade.pinAt);
          } else grenade.elapsed = now - grenade.startedAt;
          const held = pose(grenade.holderId, grenade);
          grenade.position = point(held.position);
          if (grenade.detonateAt !== null && now >= grenade.detonateAt) {
            recover(grenade, now);
          } else if (grenade.throwAt !== null && now >= grenade.throwAt && grenade.detonateAt !== null) {
            const direction = point(held.direction), length = Math.hypot(direction.x, direction.y, direction.z);
            if (length < 1e-8) throw new RangeError('Throwing requires an aim direction');
            grenade.velocity = { x: direction.x / length * profile.speed, y: direction.y / length * profile.speed + profile.lift,
              z: direction.z / length * profile.speed };
            const thrownAt = grenade.throwAt;
            recover(grenade, thrownAt);
            grenade.phase = 'flight'; grenade.throws++;
            remember({ type: 'throw', kind: grenade.kind, id: grenade.id, source: grenade.source,
              ...(grenade.aiTargetId ? { targetId: grenade.aiTargetId } : {}),
              position: Object.freeze(point(grenade.position)), time: thrownAt });
          }
        }
        if (grenade.phase === 'flight') {
          const flightStart = Math.max(now - dt, grenade.throwAt ?? now - dt);
          const flightEnd = Math.min(now, grenade.detonateAt);
          advanceGrenadeFlight(grenade, Math.max(0, flightEnd - flightStart), trace);
        }
        if (grenade.detonateAt !== null && now >= grenade.detonateAt) {
          active.delete(grenade.id);
          const event = { type: 'explosion', kind: grenade.kind, id: grenade.id, source: grenade.source, originalSource: grenade.originalSource,
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
