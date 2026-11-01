export function createAircraftFall(vehicle) {
  if (![vehicle.position.x, vehicle.position.y, vehicle.position.z, vehicle.heading, vehicle.pitch,
    vehicle.speed, vehicle.roll].every(Number.isFinite)) throw new RangeError('Aircraft fall requires its last finite flight pose');
  const speed = Math.max(0, vehicle.speed);
  return { velocity: { x: -Math.sin(vehicle.heading) * Math.cos(vehicle.pitch) * speed,
    y: Math.min(-2, Math.sin(vehicle.pitch) * speed), z: -Math.cos(vehicle.heading) * Math.cos(vehicle.pitch) * speed },
    grounded: false, groundTime: null, turnDirection: vehicle.roll < 0 ? -1 : 1 };
}

export function advanceAircraftFall(vehicle, dt, now, trace) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 || typeof trace !== 'function') {
    throw new RangeError('Aircraft falling requires simulation time and collision query');
  }
  const fall = vehicle.fall;
  if (!fall || vehicle.health > 0) throw new Error('Only a destroyed aircraft can fall');
  if (dt === 0 || fall.grounded) return false;
  const from = { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z };
  const to = { x: from.x + fall.velocity.x * dt, y: from.y + fall.velocity.y * dt - 9.81 * dt * dt / 2,
    z: from.z + fall.velocity.z * dt };
  const hit = trace(from, to);
  if (hit && ![hit.x, hit.y, hit.z].every(Number.isFinite)) throw new Error('Aircraft wreck collision returned a nonfinite hit');
  const next = hit ?? to;
  Object.assign(vehicle.position, next);
  vehicle.pitch = Math.max(-1.2, vehicle.pitch - dt * .3);
  vehicle.roll += fall.turnDirection * dt * .25;
  fall.velocity.x *= Math.exp(-dt * .25); fall.velocity.z *= Math.exp(-dt * .25);
  fall.velocity.y -= 9.81 * dt;
  if (hit) {
    fall.grounded = true; fall.groundTime = now;
    fall.velocity = { x: 0, y: 0, z: 0 };
  }
  return Boolean(hit);
}
