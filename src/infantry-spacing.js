import { AI_TURN, headingError } from './ai-turning.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function sampledRouteClear(start, end, clear) {
  if (![start.x, start.z, end.x, end.z].every(Number.isFinite) || typeof clear !== 'function') {
    throw new RangeError('Route sampling requires finite endpoints and an explicit clearance query');
  }
  const steps = Math.max(1, Math.ceil(distance(start, end) / .2));
  const check = step => {
    const result = clear(start.x + (end.x - start.x) * step / steps, start.z + (end.z - start.z) * step / steps);
    if (typeof result !== 'boolean') throw new TypeError('Route clearance must return a boolean');
    return result;
  };
  if (!check(1)) return false;
  // Probe an existing midpoint sample early; no points are added, removed or approximated.
  const middle = Math.ceil(steps / 2);
  if (middle > 1 && !check(middle)) return false;
  for (let step = 2; step <= steps; step++) if (step !== middle && !check(step)) return false;
  return true;
}

export function advanceInfantryPath(position, path, clear, arrivalRadius = .1) {
  if (!Number.isFinite(arrivalRadius) || arrivalRadius <= 0)
    throw new RangeError('Infantry route arrival radius must be positive and finite');
  while (path.length && distance(position, path[0]) < arrivalRadius &&
    Math.abs(position.y - (path[0].y ?? position.y)) < .3) path.shift();
  for (let skipped = 0; path.length > 1 && skipped < 4; skipped++) {
    const next = path[1];
    if (Math.abs(position.y - (next.y ?? position.y)) > .3 || !clear(next)) break;
    path.shift();
  }
  return path[0] ?? null;
}

export function infantrySteering(actor, neighbors, direction, { spacing, constrained, blocked, dt = 0, now = 0,
  reservations = new Map(), lookAhead = .65 }) {
  const length = Math.hypot(direction.x, direction.z);
  if (!Number.isFinite(length) || length < 1e-8 || !Number.isFinite(spacing) || spacing < 1 ||
    !Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 ||
    !Number.isFinite(lookAhead) || lookAhead <= 0 || lookAhead > .65 ||
    typeof constrained !== 'boolean' || typeof blocked !== 'function') throw new RangeError('Infantry spacing needs a finite direction, clearance and terrain query');
  const forward = { x: direction.x / length, z: direction.z / length }, right = { x: -forward.z, z: forward.x };
  const terrainClear = point => {
    const result = blocked(point);
    if (typeof result !== 'boolean') throw new TypeError('Crowd terrain query must return a boolean');
    return !result;
  };
  const sweepTerrain = point => {
    const steps = Math.max(1, Math.ceil(distance(actor.position, point) / .16));
    for (let step = 1; step <= steps; step++) {
      if (!terrainClear({ x: actor.position.x + (point.x - actor.position.x) * step / steps,
        z: actor.position.z + (point.z - actor.position.z) * step / steps })) return false;
    }
    return true;
  };
  const peers = neighbors.filter(other => other.id !== actor.id && other.health > 0 && !other.vehicleId &&
    Math.abs(other.position.y - actor.position.y) < 1.5 && distance(actor.position, other.position) < 3.2);
  // Check terrain only when a peer could affect steering; reuse it within this decision, never across steps.
  const connections = new Map();
  const connected = other => {
    if (!connections.has(other)) connections.set(other, sweepTerrain(other.position));
    return connections.get(other);
  };
  const traffic = actor.tactics.traffic ??= { waitSeconds: 0, side: 1, yieldPoint: null, until: 0,
    progress: { x: actor.position.x, z: actor.position.z }, reason: null };
  if (traffic.direction && traffic.direction.x * forward.x + traffic.direction.z * forward.z < .5) {
    traffic.yieldPoint = null; traffic.waitSeconds = 0;
  }
  traffic.direction = forward;
  const progress = (actor.position.x - traffic.progress.x) * forward.x + (actor.position.z - traffic.progress.z) * forward.z;
  traffic.waitSeconds += dt;
  if (progress > .25) {
    traffic.waitSeconds = 0; traffic.progress = { x: actor.position.x, z: actor.position.z };
  }
  const point = (dx, dz, length) => ({ x: actor.position.x + dx * length, z: actor.position.z + dz * length });
  const clear = destination => {
    if (!sweepTerrain(destination)) return false;
    const steps = Math.max(1, Math.ceil(distance(actor.position, destination) / .16));
    for (let step = 1; step <= steps; step++) {
      const p = { x: actor.position.x + (destination.x - actor.position.x) * step / steps,
        z: actor.position.z + (destination.z - actor.position.z) * step / steps };
      for (const other of peers) {
        const initial = distance(actor.position, other.position);
        const predicted = { x: other.position.x + (other.velocity?.x ?? 0) * .2 * step / steps,
          z: other.position.z + (other.velocity?.z ?? 0) * .2 * step / steps };
        if (distance(p, predicted) < Math.min(.9, initial - .01) && connected(other)) return false;
      }
    }
    return peers.every(other => {
      const entry = reservations.get(other.id);
      return !entry || distance(destination, entry) >=
        Math.min(.9, distance(actor.position, entry) - .01) || !connected(other);
    });
  };
  const result = (x, z, speed, waitingFor, reason) => {
    traffic.reason = reason;
    if (speed > 0) reservations.set(actor.id, { ...point(x, z, lookAhead * speed), y: actor.position.y });
    return { x, z, speed, waitingFor };
  };
  if (traffic.yieldPoint && (!traffic.blockerId || peers.some(other => other.id === traffic.blockerId && connected(other))) &&
    now < traffic.until && distance(actor.position, traffic.yieldPoint) > .2) {
    const dx = traffic.yieldPoint.x - actor.position.x, dz = traffic.yieldPoint.z - actor.position.z, norm = Math.hypot(dx, dz);
    if (clear(point(dx / norm, dz / norm, Math.min(lookAhead, norm)))) {
      return result(dx / norm, dz / norm, .7, traffic.blockerId, 'yield');
    }
  }
  traffic.yieldPoint = null;
  let ahead = null;
  for (const other of peers) {
    const dx = other.position.x - actor.position.x, dz = other.position.z - actor.position.z;
    const along = dx * forward.x + dz * forward.z, across = Math.abs(dx * right.x + dz * right.z);
    if (along > 0 && along < spacing + .6 && across < .95 && (!ahead || along < ahead.along) && connected(other)) ahead = { other, along, across };
  }
  const directClear = clear(point(forward.x, forward.z, lookAhead));
  if (!ahead && directClear) return result(forward.x, forward.z, 1, null, null);
  const opposing = ahead && forward.x * (ahead.other.intent?.x ?? -Math.sin(ahead.other.heading)) +
    forward.z * (ahead.other.intent?.z ?? -Math.cos(ahead.other.heading)) < -.5;
  const movingLeader = ahead && ahead.other.locomotion?.speed > .5 && !opposing;
  if (movingLeader && directClear) {
    const comfort = constrained ? 1.2 : spacing;
    const speed = Math.max(0, Math.min(1, (ahead.along - .95) / Math.max(.25, comfort - .9)));
    return result(forward.x, forward.z, speed, ahead.other.id, 'queue');
  }
  const yields = opposing && actor.tactics.id > ahead.other.tactics.id;
  const oncoming = opposing && Boolean(ahead.other.intent || ahead.other.locomotion?.speed > .1);
  if (constrained && oncoming && !yields) {
    if (directClear) return result(forward.x, forward.z, 1, null, 'right-of-way');
    if (traffic.waitSeconds < 1.5)
      return result(forward.x, forward.z, 0, ahead.other.id, 'wait-for-oncoming-yield');
  }
  const angles = constrained && yields ? [Math.PI / 2, -Math.PI / 2, Math.PI] : [.42, -.42, .85, -.85, Math.PI / 2, -Math.PI / 2];
  if (traffic.waitSeconds >= 1.5 && !angles.includes(Math.PI)) angles.push(2.3, -2.3, Math.PI);
  for (const angle of angles) {
    const c = Math.cos(angle), s = Math.sin(angle) * traffic.side;
    const x = forward.x * c + right.x * s, z = forward.z * c + right.z * s;
    if (!clear(point(x, z, lookAhead))) continue;
    // A lateral retreat is a real, held destination, not a fresh coin flip every frame.
    if (Math.abs(angle) >= .85) {
      const destination = point(x, z, constrained ? Math.max(.45, lookAhead) : 1.25);
      if (!clear(destination)) continue;
      traffic.yieldPoint = destination;
      traffic.until = now + .8 + Math.abs(headingError(actor.heading, Math.atan2(-x, -z))) / AI_TURN.movingRate;
      traffic.blockerId = ahead?.other.id ?? null;
    }
    traffic.side = s >= 0 ? 1 : -1;
    return result(x, z, .75, ahead?.other.id ?? null, 'yield');
  }
  return result(forward.x, forward.z, 0, ahead?.other.id ?? null, 'no-yield-space');
}
