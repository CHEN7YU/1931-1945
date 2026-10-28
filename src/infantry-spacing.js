const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function infantrySteering(actor, neighbors, direction, { spacing, constrained, blocked }) {
  const length = Math.hypot(direction.x, direction.z);
  if (!Number.isFinite(length) || length < 1e-8 || !Number.isFinite(spacing) || spacing < 1 ||
    typeof constrained !== 'boolean' || typeof blocked !== 'function') throw new RangeError('Infantry spacing needs a finite direction, clearance and terrain query');
  const forward = { x: direction.x / length, z: direction.z / length }, right = { x: -forward.z, z: forward.x };
  const peers = neighbors.filter(other => other !== actor && other.health > 0 && !other.vehicleId &&
    Math.abs(other.position.y - actor.position.y) < 1.5);
  let ahead = null;
  for (const other of peers) {
    const dx = other.position.x - actor.position.x, dz = other.position.z - actor.position.z;
    const along = dx * forward.x + dz * forward.z, across = Math.abs(dx * right.x + dz * right.z);
    if (along > 0 && along < spacing + .6 && across < .9 && (!ahead || along < ahead.along)) ahead = { other, along, across };
  }
  if (!ahead) return { ...forward, speed: 1, waitingFor: null };
  const clear = point => {
    const result = blocked(point);
    if (typeof result !== 'boolean') throw new TypeError('Crowd terrain query must return a boolean');
    return !result && peers.every(other => distance(other.position, point) >= .95);
  };
  const point = (dx, dz, length) => ({ x: actor.position.x + dx * length, z: actor.position.z + dz * length });
  const opposing = forward.x * -Math.sin(ahead.other.heading) + forward.z * -Math.cos(ahead.other.heading) < -.5;
  const movingLeader = ahead.other.locomotion?.speed > .5 && !opposing;
  if (!constrained && !movingLeader && clear(point(right.x, right.z, 1.25)) &&
    clear(point(right.x + forward.x * .5, right.z + forward.z * .5, 1))) {
    const x = forward.x * 1.8 + right.x * .8, z = forward.z * 1.8 + right.z * .8, norm = Math.hypot(x, z);
    return { x: x / norm, z: z / norm, speed: .75, waitingFor: ahead.other.id };
  }
  if (constrained && opposing && actor.tactics.id > ahead.other.tactics.id &&
    clear(point(-forward.x, -forward.z, .8))) {
    return { x: -forward.x, z: -forward.z, speed: .7, waitingFor: ahead.other.id };
  }
  return { ...forward, speed: Math.max(0, Math.min(1, (ahead.along - .95) / (spacing - .9))),
    waitingFor: ahead.other.id };
}
