export const PARTICLE_LIMITS = Object.freeze({ fragments: 96, clouds: 18, lights: 2 });
const valid = point => point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));

export function createParticleState() {
  return { fragments: [], clouds: [], lights: [], serial: 0, emitted: 0, time: 0,
    free: Object.fromEntries(Object.entries(PARTICLE_LIMITS).map(([name, count]) => [name, Array.from({ length: count }, () => ({}))])) };
}

function take(state, name, limit) {
  const list = state[name];
  while (list.length > limit) state.free[name].push(list.shift());
  const item = list.length >= limit ? list.shift() : state.free[name].pop();
  if (!item) throw new Error(`Particle pool exhausted: ${name}`);
  list.push(item);
  return item;
}

export function trimCombatParticles(state, limits, keepCloud = () => true) {
  for (let i = state.clouds.length - 1; i >= 0; i--) if (!keepCloud(state.clouds[i])) state.free.clouds.push(...state.clouds.splice(i, 1));
  for (const name of Object.keys(PARTICLE_LIMITS)) while (state[name].length > limits[name]) state.free[name].push(state[name].shift());
}

export function emitCombatParticles(state, position, normal, kind, options) {
  if (!valid(position) || !valid(normal)) throw new RangeError('Combat effects require finite world position and normal');
  if (!['stone', 'soil', 'wood', 'generic', 'muzzle'].includes(kind)) throw new RangeError(`Unknown particle kind: ${kind}`);
  for (const [key, cap] of [['fragmentCount', PARTICLE_LIMITS.fragments], ['fragmentLimit', PARTICLE_LIMITS.fragments], ['cloudLimit', PARTICLE_LIMITS.clouds], ['lightLimit', PARTICLE_LIMITS.lights]]) {
    if (!Number.isInteger(options[key]) || options[key] < 0 || options[key] > cap) throw new RangeError(`Invalid particle budget: ${key}`);
  }
  let seed = ++state.serial * 2654435761;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < .001) throw new RangeError('Combat effect normal cannot be zero');
  const n = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  const origin = { x: position.x + n.x * .025, y: position.y + n.y * .025, z: position.z + n.z * .025 };
  const bornAt = options.time ?? state.time;
  if (!Number.isFinite(bornAt)) throw new RangeError('Particle birth time must be finite');
  for (let i = 0; i < options.fragmentCount && options.fragmentLimit > 0; i++) {
    const jitter = { x: random() - .5, y: random() - .5, z: random() - .5 };
    const dot = jitter.x * n.x + jitter.y * n.y + jitter.z * n.z;
    const speed = (kind === 'soil' ? .75 : 1.2) + random();
    Object.assign(take(state, 'fragments', options.fragmentLimit), { ...origin, vx: (n.x + (jitter.x - dot * n.x) * .9) * speed,
      vy: (n.y + (jitter.y - dot * n.y) * .9) * speed + .3,
      vz: (n.z + (jitter.z - dot * n.z) * .9) * speed, age: 0, life: .3 + random() * .35,
      size: .012 + random() * .018, kind, spin: random() * 6.28, bornAt });
  }
  if (options.clouds && options.cloudLimit > 0) Object.assign(take(state, 'clouds', options.cloudLimit), { ...origin, vx: n.x * .12, vy: .15 + Math.max(0, n.y) * .13,
    vz: n.z * .12, age: 0, life: kind === 'muzzle' ? .32 : .45, size: kind === 'muzzle' ? .16 : .25,
    kind, rotation: random() * 6.28, bornAt });
  if (kind === 'muzzle' && options.lightLimit > 0) Object.assign(take(state, 'lights', options.lightLimit),
    { ...origin, age: 0, life: .05, intensity: 9, distance: 3, bornAt });
  state.emitted++;
}

export function emitExplosionParticles(state, position, time, { low = false, radius = 7, lights = true } = {}) {
  if (!valid(position) || !Number.isFinite(time) || time < 0 || !Number.isFinite(radius) || radius <= 0 ||
    typeof low !== 'boolean' || typeof lights !== 'boolean') throw new RangeError('Explosion effects require finite position, size and simulation time');
  let seed = ++state.serial * 2654435761;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const scale = Math.min(1.7, Math.max(.7, radius / 7)), fragmentLimit = low ? 32 : PARTICLE_LIMITS.fragments;
  const cloudLimit = low ? 6 : PARTICLE_LIMITS.clouds;
  for (let i = 0; i < (low ? 8 : 24); i++) {
    const angle = random() * Math.PI * 2, speed = (2 + random() * 5) * scale;
    Object.assign(take(state, 'fragments', fragmentLimit), { x: position.x, y: position.y + .08, z: position.z,
      vx: Math.cos(angle) * speed, vy: (1.5 + random() * 4) * scale, vz: Math.sin(angle) * speed,
      age: 0, life: .8 + random() * .9, size: .012 + random() * .028, kind: 'soil', spin: random() * 6.28, bornAt: time });
  }
  const count = low ? 5 : 12;
  for (let i = 0; i < count; i++) {
    const dust = i < count / 2, angle = i * 2.399963, spread = dust ? .35 * scale : .15 * scale;
    Object.assign(take(state, 'clouds', cloudLimit), { x: position.x + Math.cos(angle) * spread,
      y: position.y + (dust ? .08 : .25) * scale, z: position.z + Math.sin(angle) * spread,
      vx: Math.cos(angle) * (dust ? 1.1 : .15) * scale, vy: (dust ? .12 : .55 + random() * .3) * scale,
      vz: Math.sin(angle) * (dust ? 1.1 : .15) * scale, age: 0,
      life: dust ? 1.1 + random() * .5 : 1.8 + random() * .6,
      size: (dust ? .55 : .65) * scale, kind: dust ? 'blast-dust' : 'blast-smoke', rotation: random() * 6.28, bornAt: time });
  }
  Object.assign(take(state, 'clouds', cloudLimit), { x: position.x, y: position.y + .12, z: position.z,
    vx: 0, vy: .2, vz: 0, age: 0, life: .10, size: .7 * scale, kind: 'blast-flash', rotation: random() * 6.28, bornAt: time });
  if (!low && lights) Object.assign(take(state, 'lights', PARTICLE_LIMITS.lights),
    { x: position.x, y: position.y + .2, z: position.z, age: 0, life: .09, intensity: 22 * scale, distance: 5 * scale, bornAt: time });
  state.emitted++;
}

export function advanceCombatParticles(state, dt, groundHeight, now = state.time + dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Particle timestep must be finite and non-negative');
  if (!Number.isFinite(now) || now < state.time) throw new RangeError('Particle clock must be finite and monotonic');
  for (const particle of state.fragments) {
    const age = Math.max(0, now - particle.bornAt), elapsed = age - particle.age;
    const steps = Math.max(1, Math.ceil(elapsed / .016));
    for (let i = 0; i < steps; i++) {
      const step = elapsed / steps;
      particle.vy -= 9.8 * step;
      particle.x += particle.vx * step; particle.y += particle.vy * step; particle.z += particle.vz * step;
      const floor = groundHeight(particle.x, particle.z) + particle.size;
      if (particle.y < floor) {
        particle.y = floor;
        particle.vy = Math.abs(particle.vy) * .2;
        particle.vx *= .6; particle.vz *= .6;
      }
    }
    particle.age = age;
  }
  for (const cloud of state.clouds) {
    const age = Math.max(0, now - cloud.bornAt), elapsed = age - cloud.age;
    cloud.x += cloud.vx * elapsed; cloud.y += cloud.vy * elapsed; cloud.z += cloud.vz * elapsed; cloud.age = age;
  }
  for (const light of state.lights) light.age = Math.max(0, now - light.bornAt);
  state.time = now;
  for (const name of Object.keys(PARTICLE_LIMITS)) for (let i = state[name].length - 1; i >= 0; i--) {
    if (state[name][i].age >= state[name][i].life) state.free[name].push(...state[name].splice(i, 1));
  }
}

export function clearCombatParticles(state) {
  trimCombatParticles(state, { fragments: 0, clouds: 0, lights: 0 });
  state.time = state.serial = state.emitted = 0;
}
// ---模块结束---
