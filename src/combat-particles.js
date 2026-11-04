export const PARTICLE_LIMITS = Object.freeze({ fragments: 96, clouds: 18, lights: 2 });
export const EXPLOSION_STYLES = Object.freeze(['default', 'explosive-pack', 'tank-shell', 'tank-destruction']);
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

export function emitExplosionParticles(state, position, time, { low = false, radius = 7, lights = true, style = 'default',
  normal = { x: 0, y: 1, z: 0 }, material = 'soil' } = {}) {
  if (!valid(position) || !Number.isFinite(time) || time < 0 || !Number.isFinite(radius) || radius <= 0 ||
    typeof low !== 'boolean' || typeof lights !== 'boolean' || !EXPLOSION_STYLES.includes(style) ||
    !valid(normal) || Math.hypot(normal.x, normal.y, normal.z) < .001 ||
    !['soil', 'stone', 'wood', 'generic'].includes(material)) throw new RangeError('Explosion effects require finite position, size, style, surface and simulation time');
  const length = Math.hypot(normal.x, normal.y, normal.z);
  const n = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  const tangentLength = Math.hypot(n.x, n.z);
  const u = tangentLength > .001 ? { x: n.z / tangentLength, y: 0, z: -n.x / tangentLength } : { x: 1, y: 0, z: 0 };
  const v = { x: n.y * u.z, y: n.z * u.x - n.x * u.z, z: -n.y * u.x };
  const outward = (angle, distance) => ({ x: (Math.cos(angle) * u.x + Math.sin(angle) * v.x) * distance,
    y: (Math.cos(angle) * u.y + Math.sin(angle) * v.y) * distance,
    z: (Math.cos(angle) * u.z + Math.sin(angle) * v.z) * distance });
  let seed = ++state.serial * 2654435761;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const tank = style === 'tank-destruction', shell = style === 'tank-shell', heavy = style !== 'default';
  const impact = position, createdClouds = [];
  if (shell) position = { x: position.x + n.x * .1, y: position.y + n.y * .1, z: position.z + n.z * .1 };
  const scale = Math.min(1.7, Math.max(.7, radius / 7)) * (tank ? 2 : shell ? 1.4 : heavy ? 1.65 : 1);
  const fragmentLimit = low ? 32 : PARTICLE_LIMITS.fragments;
  const cloudLimit = low ? 6 : PARTICLE_LIMITS.clouds;
  const takeCloud = () => {
    const cloud = take(state, 'clouds', cloudLimit);
    if (shell) createdClouds.push(cloud);
    return cloud;
  };
  for (let i = 0; i < (low ? heavy ? 16 : 8 : heavy ? 48 : 24); i++) {
    const angle = random() * Math.PI * 2, speed = (2 + random() * 5) * scale;
    const radial = outward(angle, speed), impulse = (1.5 + random() * 4) * scale;
    Object.assign(take(state, 'fragments', fragmentLimit), { x: position.x, y: position.y + .08, z: position.z,
      vx: shell ? radial.x + n.x * impulse : Math.cos(angle) * speed,
      vy: shell ? radial.y + n.y * impulse + 1.5 : impulse, vz: shell ? radial.z + n.z * impulse : Math.sin(angle) * speed,
      age: 0, life: .8 + random() * (heavy ? 1.6 : .9),
      size: (.012 + random() * .028) * (shell && i % 4 === 0 ? 4 : heavy ? 2.5 : 1),
      kind: tank ? 'generic' : shell ? material : 'soil', spin: random() * 6.28, bornAt: time });
  }
  const count = low ? heavy ? 3 : 5 : heavy ? 9 : 12;
  for (let i = 0; i < count; i++) {
    const dust = i < (heavy ? low ? 1 : 4 : count / 2), angle = i * 2.399963;
    const spread = (dust ? .35 : tank ? .5 : .15) * scale;
    const radial = outward(angle, spread), drift = outward(angle, (dust ? shell ? 1.6 : 1.1 : shell ? .4 : .15) * scale);
    Object.assign(takeCloud(), { style, x: position.x + (shell ? radial.x : Math.cos(angle) * spread),
      y: position.y + (dust ? .08 : .25) * scale + (shell ? radial.y : 0), z: position.z + (shell ? radial.z : Math.sin(angle) * spread),
      vx: shell ? drift.x + n.x * .5 : Math.cos(angle) * (dust ? 1.1 : .15) * scale,
      vy: (dust ? .12 : .55 + random() * .3) * scale + (shell ? drift.y + n.y * .3 : 0),
      vz: shell ? drift.z + n.z * .5 : Math.sin(angle) * (dust ? 1.1 : .15) * scale, age: 0,
      life: dust ? (shell ? .85 : 1.1) + random() * .5 : (tank ? 5 : shell ? 2.1 : heavy ? 2.5 : 1.8) + random() * .6,
      size: (dust ? shell ? 1 : .55 : tank ? 1 : shell ? .95 : .65) * scale,
      kind: dust ? 'blast-dust' : tank ? 'blast-soot' : 'blast-smoke', rotation: random() * 6.28, bornAt: time });
  }
  if (heavy) {
    for (let i = 0; i < (low ? 1 : shell ? 3 : 6); i++) {
      const angle = i * 2.399963, spread = (i ? .45 : 0) * scale;
      const radial = outward(angle, spread);
      Object.assign(takeCloud(), { style, x: position.x + (shell ? radial.x : Math.cos(angle) * spread),
        y: position.y + .2 + (i % 3) * .3 * scale + (shell ? radial.y : 0),
        z: position.z + (shell ? radial.z : Math.sin(angle) * spread),
        vx: shell ? n.x * .5 : Math.cos(angle) * .5 * scale, vy: (tank ? .8 : .6) * scale,
        vz: shell ? n.z * .5 : Math.sin(angle) * .5 * scale,
        age: 0, life: (tank ? 1.6 : shell ? .22 : .7) + random() * (shell ? .13 : .35), size: (tank ? 1.25 : shell ? .9 : 1) * scale,
        kind: 'blast-fire', rotation: random() * 6.28, bornAt: time });
    }
    Object.assign(takeCloud(), { style, normal: shell ? { ...n } : null,
      baseOpacity: shell ? .22 : .36, x: position.x, y: position.y, z: position.z,
      vx: 0, vy: 0, vz: 0, age: 0, life: shell ? .38 : .6, size: 2.4 * scale,
      kind: 'blast-wave', rotation: 0, bornAt: time });
  }
  Object.assign(takeCloud(), { style, x: position.x, y: position.y + .12, z: position.z,
    vx: 0, vy: .2, vz: 0, age: 0, life: heavy ? .14 : .10, size: (shell ? 1.7 : heavy ? 2 : .7) * scale,
    kind: 'blast-flash', rotation: random() * 6.28, bornAt: time });
  for (const cloud of createdClouds) {
    const distance = (cloud.x - impact.x) * n.x + (cloud.y - impact.y) * n.y + (cloud.z - impact.z) * n.z;
    const shift = Math.max(0, .14 - distance);
    cloud.x += n.x * shift; cloud.y += n.y * shift; cloud.z += n.z * shift;
    const inward = cloud.vx * n.x + cloud.vy * n.y + cloud.vz * n.z;
    if (inward < .1) {
      cloud.vx += n.x * (.1 - inward); cloud.vy += n.y * (.1 - inward); cloud.vz += n.z * (.1 - inward);
    }
  }
  if (!low && lights) Object.assign(take(state, 'lights', PARTICLE_LIMITS.lights),
    { x: position.x + (shell ? n.x * .25 : 0), y: position.y + (shell ? n.y * .25 : .2),
      z: position.z + (shell ? n.z * .25 : 0), age: 0, life: heavy ? .18 : .09,
      intensity: (heavy ? 65 : 22) * scale, distance: (heavy ? 9 : 5) * scale, bornAt: time });
  state.emitted++;
}

export function advanceCombatParticles(state, dt, groundHeight, now = state.time + dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Particle timestep must be finite and non-negative');
  if (!Number.isFinite(now) || now < state.time) throw new RangeError('Particle clock must be finite and monotonic');
  for (const particle of state.fragments) {
    const age = Math.max(0, now - particle.bornAt), elapsed = age - particle.age;
    if (age >= particle.life) { particle.age = age; continue; }
    if (elapsed === 0) continue;
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
