export const PROJECTILE_LIMIT = 32;

const point = value => {
  if (!value || !['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]))) throw new RangeError('Projectile positions must be finite');
  return { x: value.x, y: value.y, z: value.z };
};

export function createProjectile({ id, source, start, target, duration, damage, radius, firedAt }) {
  if (!id || !source?.soldierId || !source.unitId || !source.weaponId ||
    !['player', 'ally', 'enemy'].includes(source.credit)) throw new Error('Projectile requires an identity and original attack source');
  if (![duration, radius].every(value => Number.isFinite(value) && value > 0) ||
    ![damage, firedAt].every(value => Number.isFinite(value) && value >= 0)) throw new RangeError('Invalid projectile timing or damage');
  const origin = Object.freeze(point(start)), destination = Object.freeze(point(target));
  return { id, source: Object.freeze({ ...source }), start: origin, target: destination, position: { ...origin },
    elapsed: 0, duration, damage, radius, firedAt, active: true,
    arcHeight: 12 + Math.hypot(destination.x - origin.x, destination.y - origin.y, destination.z - origin.z) * .22 };
}

export function advanceProjectile(projectile, dt, trace) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Projectile timestep must be non-negative and finite');
  if (!projectile.active || dt === 0) return null;
  const previous = { ...projectile.position };
  projectile.elapsed = Math.min(projectile.duration, projectile.elapsed + dt);
  const fraction = projectile.elapsed / projectile.duration;
  for (const axis of ['x', 'y', 'z']) projectile.position[axis] = projectile.start[axis] + (projectile.target[axis] - projectile.start[axis]) * fraction;
  projectile.position.y += Math.sin(fraction * Math.PI) * projectile.arcHeight;
  const hit = trace(previous, { ...projectile.position });
  if (!hit && fraction < 1) return null;
  const position = Object.freeze(point(hit || projectile.target));
  Object.assign(projectile.position, position);
  projectile.active = false;
  return Object.freeze({ projectileId: projectile.id, source: projectile.source, position, damage: projectile.damage,
    radius: projectile.radius, time: projectile.firedAt + projectile.elapsed, collided: Boolean(hit) });
}
