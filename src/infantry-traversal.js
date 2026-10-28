import { circleBlocked } from './core.js';

export const TRAVERSAL = Object.freeze({
  radius: .4, bodyHeight: 1.75, gravity: 15, jumpSpeed: 5,
  minVaultHeight: .4, maxVaultHeight: 1.35, maxThickness: 1.4,
  reach: 1.05, clearance: .06, vaultSeconds: .85, jumpCost: .08, vaultCost: .14,
});

export function createTraversal() {
  return { kind: 'grounded', velocity: 0, baseY: 0, elapsed: 0, plan: null, blocked: false };
}

function overlaps(position, obstacle, radius) {
  return circleBlocked(position.x, position.z, radius, [obstacle], obstacle.height - .04, .08);
}

export function landingHeight(position, referenceY, obstacles, heightAt) {
  let height = heightAt(position.x, position.z, referenceY);
  for (const obstacle of obstacles) {
    if (!Number.isFinite(obstacle.height) || obstacle.height > referenceY + .025 || obstacle.height <= height) continue;
    if (overlaps(position, obstacle, TRAVERSAL.radius)) height = obstacle.height;
  }
  return height;
}

export function moveAirborne(position, dx, dz, radius, obstacles, bodyHeight = TRAVERSAL.bodyHeight) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .04));
  for (let i = 0; i < steps; i++) {
    if (!circleBlocked(position.x + dx / steps, position.z, radius, obstacles, position.y, bodyHeight)) position.x += dx / steps;
    if (!circleBlocked(position.x, position.z + dz / steps, radius, obstacles, position.y, bodyHeight)) position.z += dz / steps;
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

export function beginTraversal(state, position, plan = null) {
  if (state.kind !== 'grounded') return false;
  Object.assign(state, { kind: plan ? 'vaulting' : 'jumping', baseY: position.y,
    elapsed: 0, velocity: plan ? 0 : TRAVERSAL.jumpSpeed, plan, blocked: false });
  return true;
}

export function advanceTraversal(state, position, dt, obstacles, heightAt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Traversal requires finite non-negative time');
  let impact = null;
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
  for (let i = 0; i < steps && state.kind !== 'grounded'; i++) {
    if (state.kind === 'vaulting') {
      const elapsed = Math.min(TRAVERSAL.vaultSeconds, state.elapsed + h);
      const next = vaultPosition(state.plan, elapsed / TRAVERSAL.vaultSeconds);
      if (circleBlocked(next.x, next.z, TRAVERSAL.radius, obstacles, next.y, TRAVERSAL.bodyHeight)) {
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
          position.y = floor; impact = Math.abs(velocity); state.kind = 'grounded'; state.velocity = 0;
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
