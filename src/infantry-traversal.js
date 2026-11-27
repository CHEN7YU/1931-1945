import { circleBlocked } from './core.js';

export const TRAVERSAL = Object.freeze({
  radius: .4, bodyHeight: 1.75, gravity: 15, jumpSpeed: 5,
  minVaultHeight: .4, maxVaultHeight: 1.35, maxThickness: 1.4,
  reach: 1.05, clearance: .06, vaultSeconds: .85, jumpCost: .08, vaultCost: .14,
});

export const FALL_DAMAGE = Object.freeze({ safeDrop: 3, lethalDrop: 8, lethalDamage: 100 });

export function landingDamage(impactSpeed) {
  if (!Number.isFinite(impactSpeed) || impactSpeed < 0) throw new RangeError('Landing speed must be finite and non-negative');
  const drop = impactSpeed * impactSpeed / (2 * TRAVERSAL.gravity);
  return Math.min(FALL_DAMAGE.lethalDamage, Math.max(0,
    (drop - FALL_DAMAGE.safeDrop) / (FALL_DAMAGE.lethalDrop - FALL_DAMAGE.safeDrop) * FALL_DAMAGE.lethalDamage));
}

export function createTraversal() {
  return { kind: 'grounded', velocity: 0, baseY: 0, elapsed: 0, plan: null, blocked: false };
}

function overlaps(position, obstacle, radius) {
  return circleBlocked(position.x, position.z, radius, [obstacle], obstacle.height - .04, .08);
}

export function landingHeight(position, referenceY, obstacles, heightAt) {
  let height = heightAt(position.x, position.z, referenceY);
  for (const obstacle of obstacles) {
    if (obstacle.nonSupporting) continue;
    if (!Number.isFinite(obstacle.height) || obstacle.height > referenceY + .025 || obstacle.height <= height) continue;
    if (overlaps(position, obstacle, TRAVERSAL.radius)) height = obstacle.height;
  }
  return height;
}

export function reservationMovementBlockers(position, radius, obstacles, bodyHeight = TRAVERSAL.bodyHeight) {
  if (!obstacles.some(obstacle => obstacle.nonSupporting &&
    circleBlocked(position.x, position.z, radius, [obstacle], position.y, bodyHeight))) return obstacles;
  return obstacles.filter(obstacle => !obstacle.nonSupporting ||
    !circleBlocked(position.x, position.z, radius, [obstacle], position.y, bodyHeight));
}

export function moveAirborne(position, dx, dz, radius, obstacles, bodyHeight = TRAVERSAL.bodyHeight, heightAt = null) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .04));
  const reserved = obstacles.some(obstacle => obstacle.nonSupporting);
  const terrainClear = (x, z) => !heightAt || heightAt(x, z, position.y) <= position.y + .025;
  for (let i = 0; i < steps; i++) {
    let blockers = reserved ? reservationMovementBlockers(position, radius, obstacles, bodyHeight) : obstacles;
    if (terrainClear(position.x + dx / steps, position.z) &&
      !circleBlocked(position.x + dx / steps, position.z, radius, blockers, position.y, bodyHeight)) position.x += dx / steps;
    blockers = reserved ? reservationMovementBlockers(position, radius, obstacles, bodyHeight) : obstacles;
    if (terrainClear(position.x, position.z + dz / steps) &&
      !circleBlocked(position.x, position.z + dz / steps, radius, blockers, position.y, bodyHeight)) position.z += dz / steps;
  }
  return position;
}

export function moveSupported(position, dx, dz, radius, obstacles, heightAt, moveGround,
  bodyHeight = TRAVERSAL.bodyHeight, maxDrop = Infinity) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .04));
  const reserved = obstacles.some(obstacle => obstacle.nonSupporting);
  for (let step = 0; step < steps; step++) {
    const next = { x: position.x + dx / steps, z: position.z + dz / steps };
    const terrain = heightAt(next.x, next.z, position.y);
    const floor = landingHeight(next, position.y, obstacles, heightAt);
    if (position.y - floor > maxDrop) continue;
    if (position.y - floor > .25 &&
      position.y - landingHeight(position, position.y, obstacles, heightAt) <= .25 &&
      obstacles.some(obstacle => obstacle.nonSupporting &&
        circleBlocked(next.x, next.z, radius, [obstacle], floor, bodyHeight))) continue;
    // Let the body clear a low edge before its support footprint releases.
    const move = position.y - Math.min(terrain, floor) > .25 ? moveAirborne : moveGround;
    const blockers = reserved ? reservationMovementBlockers(position, radius, obstacles, bodyHeight) : obstacles;
    if (blockers !== obstacles && dx && dz) {
      move(position, dx / steps, 0, radius, blockers, bodyHeight);
      move(position, 0, dz / steps, radius,
        reservationMovementBlockers(position, radius, obstacles, bodyHeight), bodyHeight);
    } else move(position, dx / steps, dz / steps, radius, blockers, bodyHeight);
  }
  return position;
}

export function vaultPosition(plan, progress) {
  const smooth = value => value * value * (3 - 2 * value);
  const t = Math.max(0, Math.min(1, progress));
  if (t < .3) return { ...plan.start, y: plan.start.y + (plan.top - plan.start.y) * smooth(t / .3) };
  if (t < .7) {
    const along = smooth((t - .3) / .4);
    return { x: plan.start.x + (plan.end.x - plan.start.x) * along, y: plan.top,
      z: plan.start.z + (plan.end.z - plan.start.z) * along };
  }
  return { ...plan.end, y: plan.top + (plan.end.y - plan.top) * smooth((t - .7) / .3) };
}

export function findVault(position, yaw, obstacles, heightAt) {
  if (![position.x, position.y, position.z, yaw].every(Number.isFinite)) throw new RangeError('Vault requires a finite owned pose');
  const direction = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const candidates = [];
  for (const obstacle of obstacles) {
    if (![obstacle.minX, obstacle.maxX, obstacle.minZ, obstacle.maxZ, obstacle.height].every(Number.isFinite)) continue;
    const height = obstacle.height - position.y;
    if (height < TRAVERSAL.minVaultHeight || height > TRAVERSAL.maxVaultHeight ||
      obstacle.door || obstacle.oriented || obstacle.circular || obstacle.vehicleId) continue;
    let near = -Infinity, far = Infinity;
    for (const axis of ['x', 'z']) {
      const min = obstacle[axis === 'x' ? 'minX' : 'minZ'], max = obstacle[axis === 'x' ? 'maxX' : 'maxZ'];
      if (Math.abs(direction[axis]) < 1e-8) {
        if (position[axis] < min || position[axis] > max) far = -Infinity;
      } else {
        const a = (min - position[axis]) / direction[axis], b = (max - position[axis]) / direction[axis];
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      }
    }
    if (near < TRAVERSAL.radius - .025 || near > TRAVERSAL.reach || far < near || far - near > TRAVERSAL.maxThickness) continue;
    candidates.push({ obstacle, near, far });
  }
  candidates.sort((a, b) => a.near - b.near);
  for (const { obstacle, far } of candidates) {
    const end = { x: position.x + direction.x * (far + TRAVERSAL.radius + .08),
      z: position.z + direction.z * (far + TRAVERSAL.radius + .08) };
    end.y = heightAt(end.x, end.z, position.y);
    if (Math.abs(end.y - position.y) > .5) continue;
    const plan = { start: { ...position }, end, top: obstacle.height + TRAVERSAL.clearance };
    let clear = true;
    for (let i = 0; i <= 100; i++) {
      const point = vaultPosition(plan, i / 100);
      if (circleBlocked(point.x, point.z, TRAVERSAL.radius, obstacles, point.y, TRAVERSAL.bodyHeight)) { clear = false; break; }
    }
    if (clear) return plan;
  }
  return null;
}

export function findSillClimb(position, yaw, openings, obstacles, heightAt) {
  if (![position.x, position.y, position.z, yaw].every(Number.isFinite))
    throw new RangeError('Sill climb requires a finite owned pose');
  const direction = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, candidates = [];
  for (const opening of openings) {
    if (!opening.blown || !['x', 'z'].includes(opening.axis)) continue;
    const normal = opening.axis === 'x' ? 'z' : 'x';
    const along = opening.axis;
    if (Math.abs(direction[normal]) < .7) continue;
    const distance = (opening[normal] - position[normal]) / direction[normal];
    if (distance < TRAVERSAL.radius || distance > TRAVERSAL.reach) continue;
    const end = { x: position.x + direction.x * distance, z: position.z + direction.z * distance };
    if (Math.abs(end[along] - opening[along]) > opening.width / 2 - TRAVERSAL.radius) continue;
    const support = landingHeight(end, opening.bottom + .25, obstacles, heightAt);
    const rise = support - position.y;
    if (rise < .2 || rise > TRAVERSAL.maxVaultHeight || Math.abs(support - opening.bottom) > .25) continue;
    end.y = support;
    const plan = { start: { ...position }, end, top: support + TRAVERSAL.clearance };
    if (Array.from({ length: 101 }, (_, index) => vaultPosition(plan, index / 100))
      .some(point => circleBlocked(point.x, point.z, TRAVERSAL.radius, obstacles, point.y, TRAVERSAL.bodyHeight)))
      continue;
    candidates.push({ distance, plan });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.plan ?? null;
}

export function beginTraversal(state, position, plan = null) {
  if (state.kind !== 'grounded') return false;
  Object.assign(state, { kind: plan ? 'vaulting' : 'jumping', baseY: position.y,
    elapsed: 0, velocity: plan ? 0 : TRAVERSAL.jumpSpeed, plan, blocked: false });
  return true;
}

export function advanceTraversal(state, position, dt, obstacles, heightAt, traversalBlockers = []) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Traversal requires finite non-negative time');
  let impact = null;
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
  for (let i = 0; i < steps && state.kind !== 'grounded'; i++) {
    if (state.kind === 'vaulting') {
      const elapsed = Math.min(TRAVERSAL.vaultSeconds, state.elapsed + h);
      const next = vaultPosition(state.plan, elapsed / TRAVERSAL.vaultSeconds);
      if (circleBlocked(next.x, next.z, TRAVERSAL.radius, obstacles, next.y, TRAVERSAL.bodyHeight) ||
        circleBlocked(next.x, next.z, TRAVERSAL.radius, traversalBlockers, next.y, TRAVERSAL.bodyHeight)) {
        state.kind = 'jumping'; state.velocity = 0; state.plan = null; state.blocked = true;
        continue;
      }
      Object.assign(position, next);
      state.elapsed = elapsed;
      if (elapsed === TRAVERSAL.vaultSeconds) {
        state.kind = 'grounded'; state.plan = null; state.velocity = 0; impact = 2;
      }
    } else {
      const velocity = state.velocity - TRAVERSAL.gravity * h;
      const nextY = position.y + (state.velocity + velocity) * .5 * h;
      if (velocity <= 0) {
        const floor = landingHeight(position, position.y, obstacles, heightAt);
        if (floor <= position.y + .025 && nextY <= floor) {
          impact = Math.sqrt(state.velocity * state.velocity + 2 * TRAVERSAL.gravity * Math.max(0, position.y - floor));
          position.y = floor; state.kind = 'grounded'; state.velocity = 0;
          continue;
        }
      }
      if (circleBlocked(position.x, position.z, TRAVERSAL.radius, obstacles, nextY, TRAVERSAL.bodyHeight)) {
        state.velocity = Math.min(0, velocity);
      } else {
        position.y = nextY; state.velocity = velocity;
      }
    }
  }
  return impact;
}
