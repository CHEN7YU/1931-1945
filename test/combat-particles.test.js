import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTICLE_LIMITS, createParticleState, emitCombatParticles, emitExplosionParticles, advanceCombatParticles, clearCombatParticles, trimCombatParticles } from '../src/combat-particles.js';

const options = { fragmentCount: 8, fragmentLimit: 96, clouds: true, cloudLimit: 18, lightLimit: 2 };
const position = { x: 8, y: .45, z: -16 }, normal = { x: 0, y: 1, z: 0 };
test('effects are bounded and reuse preallocated state objects through long firing sequences', () => {
  const state = createParticleState();
  const identities = Object.fromEntries(Object.keys(PARTICLE_LIMITS).map(name => [name, new Set(state.free[name])]));
  for (let i = 0; i < 300; i++) {
    emitCombatParticles(state, position, normal, i % 2 ? 'stone' : 'muzzle', options);
    advanceCombatParticles(state, .01, () => .45);
    for (const [name, limit] of Object.entries(PARTICLE_LIMITS)) {
      assert.ok(state[name].length <= limit);
      assert.equal(state[name].length + state.free[name].length, limit);
      assert.ok(state[name].every(item => identities[name].has(item)));
    }
  }
  advanceCombatParticles(state, 2, () => .45);
  assert.equal(state.fragments.length + state.clouds.length + state.lights.length, 0);
});
test('short muzzle lights are visible on their birth frame even at a 50ms simulation step', () => {
  const state = createParticleState();
  emitCombatParticles(state, position, normal, 'muzzle', { ...options, fragmentCount: 0, time: .05 });
  advanceCombatParticles(state, .05, () => 0, .05);
  assert.equal(state.lights.length, 1);
  assert.equal(state.lights[0].age, 0);
  advanceCombatParticles(state, .05, () => 0, .1);
  assert.equal(state.lights.length, 0);
});
test('world fragments stay above the shared bridge support and fully reset between battles', () => {
  const state = createParticleState();
  emitCombatParticles(state, position, normal, 'soil', options);
  for (let i = 0; i < 30; i++) {
    advanceCombatParticles(state, .016, () => .45);
    assert.ok(state.fragments.every(item => item.y >= .45 + item.size - 1e-10));
  }
  clearCombatParticles(state);
  assert.equal(state.time, 0);
  assert.equal(state.emitted, 0);
  for (const [name, limit] of Object.entries(PARTICLE_LIMITS)) assert.equal(state.free[name].length, limit);
});
test('catch-up substeps retain short flashes until the actual render birth time', () => {
  const state = createParticleState();
  emitCombatParticles(state, position, normal, 'muzzle', { ...options, fragmentCount: 0, time: .25 });
  for (const now of [.05, .1, .15, .2, .25]) {
    advanceCombatParticles(state, .05, () => 0, now);
    assert.equal(state.lights.length, 1);
    assert.equal(state.lights[0].age, 0);
  }
  advanceCombatParticles(state, .025, () => 0, .275);
  assert.ok(Math.abs(state.lights[0].age - .025) < 1e-9);
  advanceCombatParticles(state, .026, () => 0, .301);
  assert.equal(state.lights.length, 0);
});
test('lower quality and independent disable immediately recycle effects without allocating replacements', () => {
  const state = createParticleState();
  for (let i = 0; i < 20; i++) emitCombatParticles(state, position, normal, 'muzzle', options);
  trimCombatParticles(state, { fragments: 32, clouds: 6, lights: 0 }, cloud => cloud.kind !== 'muzzle');
  assert.ok(state.fragments.length <= 32);
  assert.equal(state.clouds.length, 0);
  assert.equal(state.lights.length, 0);
  for (const [name, limit] of Object.entries(PARTICLE_LIMITS)) assert.equal(state[name].length + state.free[name].length, limit);
});
test('visual input errors are explicit and do not poison the pool', () => {
  const state = createParticleState();
  assert.throws(() => emitCombatParticles(state, position, { x: 0, y: 0, z: 0 }, 'stone', options), RangeError);
  assert.throws(() => emitCombatParticles(state, position, normal, 'unknown', options), RangeError);
  assert.throws(() => emitCombatParticles(state, position, normal, 'soil', { ...options, fragmentLimit: 1000 }), RangeError);
  assert.throws(() => advanceCombatParticles(state, -1, () => 0), RangeError);
});

test('explosions have a short flash, ballistic fragments, outward dust and lingering smoke in the existing bounded pools', () => {
  for (const low of [false, true]) {
    const state = createParticleState();
    emitExplosionParticles(state, position, .05, { low });
    assert.ok(state.fragments.length >= 8 && state.clouds.some(cloud => cloud.kind === 'blast-flash'));
    assert.ok(state.clouds.some(cloud => cloud.kind === 'blast-dust') && state.clouds.some(cloud => cloud.kind === 'blast-smoke'));
    assert.equal(state.lights.length, low ? 0 : 1);
    advanceCombatParticles(state, .05, () => .45, .05);
    assert.ok(state.clouds.every(cloud => cloud.age === 0), 'first displayed frame retains short flash');
    advanceCombatParticles(state, .15, () => .45, .2);
    assert.ok(!state.clouds.some(cloud => cloud.kind === 'blast-flash'));
    assert.ok(state.clouds.some(cloud => cloud.kind === 'blast-smoke'));
    for (let i = 0; i < 80; i++) emitExplosionParticles(state, position, .2, { low });
    for (const [name, cap] of Object.entries(PARTICLE_LIMITS)) assert.equal(state[name].length + state.free[name].length, cap);
    advanceCombatParticles(state, 3, () => .45, 3.2);
    assert.equal(state.fragments.length + state.clouds.length + state.lights.length, 0);
  }
});

test('packs and tank destruction are visibly larger than grenades without changing the pool budgets', () => {
  const grenade = createParticleState();
  emitExplosionParticles(grenade, position, 0);
  const flash = grenade.clouds.find(cloud => cloud.kind === 'blast-flash');
  for (const style of ['explosive-pack', 'tank-destruction']) for (const low of [false, true]) {
    const state = createParticleState();
    emitExplosionParticles(state, position, 0, { style, low, radius: style === 'explosive-pack' ? 9 : 7 });
    assert.ok(state.clouds.find(cloud => cloud.kind === 'blast-flash').size > flash.size * 4);
    assert.equal(state.fragments.length, low ? 16 : 48);
    assert.equal(state.clouds.filter(cloud => cloud.kind === 'blast-fire').length, low ? 1 : 6);
    assert.equal(state.clouds.filter(cloud => cloud.kind === 'blast-wave').length, 1);
    assert.ok(state.fragments.every(particle => Math.hypot(particle.vx, particle.vz) >= 3));
    assert.ok(state.clouds.length <= (low ? 6 : 18));
    advanceCombatParticles(state, .3, () => .45, .3);
    assert.ok(!state.clouds.some(cloud => cloud.kind === 'blast-flash'));
    assert.ok(state.clouds.some(cloud => cloud.kind === 'blast-fire'));
    assert.ok(state.clouds.some(cloud => cloud.kind === 'blast-wave'));
    advanceCombatParticles(state, 1.8, () => .45, 2.1);
    assert.ok(!state.clouds.some(cloud => ['blast-fire', 'blast-wave'].includes(cloud.kind)));
    if (style === 'tank-destruction') {
      assert.ok(state.clouds.every(cloud => cloud.kind === 'blast-soot'));
      advanceCombatParticles(state, 2, () => .45, 4.1);
      assert.ok(state.clouds.length > 0, 'black smoke persists after the initial tank fireball');
    }
    advanceCombatParticles(state, 6, () => .45, 8.1);
    assert.equal(state.fragments.length + state.clouds.length + state.lights.length, 0);
    for (let i = 0; i < 80; i++) emitExplosionParticles(state, position, 8.1, { style, low });
    for (const [name, cap] of Object.entries(PARTICLE_LIMITS)) assert.equal(state[name].length + state.free[name].length, cap);
    clearCombatParticles(state);
    assert.equal(state.fragments.length + state.clouds.length + state.lights.length, 0);
  }
});

test('invalid explosion styles are rejected before mutating the particle pool', () => {
  const state = createParticleState();
  assert.throws(() => emitExplosionParticles(state, position, 0, { style: 'unknown' }), RangeError);
  assert.equal(state.serial, 0);
  assert.equal(state.emitted, 0);
});

test('tank shells emit visible surface-facing fragments and a short flash rather than a long fuel fireball', () => {
  for (const low of [false, true]) {
    const state = createParticleState(), wall = { x: 0, y: 0, z: 1 }, point = { x: 2, y: 3, z: 10 };
    emitExplosionParticles(state, point, 0, { low, radius: 11, style: 'tank-shell', normal: wall, material: 'stone' });
    assert.ok(state.fragments.every(particle => particle.z > point.z && particle.vz > 0 && particle.kind === 'stone'));
    assert.ok(state.clouds.some(cloud => cloud.kind === 'blast-flash'));
    const wave = state.clouds.find(cloud => cloud.kind === 'blast-wave');
    assert.deepEqual(wave.normal, wall);
    assert.ok(state.clouds.filter(cloud => cloud.kind === 'blast-fire').every(cloud => cloud.life <= .35));
    advanceCombatParticles(state, .5, () => 0, .5);
    assert.ok(state.clouds.some(cloud => cloud.kind === 'blast-smoke'));
    assert.ok(!state.clouds.some(cloud => cloud.kind === 'blast-flash' || cloud.kind === 'blast-fire'));
    emitExplosionParticles(state, point, .5, { low, style: 'explosive-pack' });
    assert.equal(state.clouds.find(cloud => cloud.kind === 'blast-wave' && cloud.style === 'explosive-pack').normal, null);
    for (const [name, cap] of Object.entries(PARTICLE_LIMITS)) assert.equal(state[name].length + state.free[name].length, cap);
  }
});

test('shell smoke and light remain outside an inclined roof underside rather than rising inside the solid', () => {
  const state = createParticleState(), n = { x: -.315, y: -.949, z: 0 };
  const length = Math.hypot(n.x, n.y, n.z); n.x /= length; n.y /= length;
  emitExplosionParticles(state, position, 0, { style: 'tank-shell', normal: n, material: 'stone' });
  for (const cloud of state.clouds) {
    assert.ok((cloud.x - position.x) * n.x + (cloud.y - position.y) * n.y + (cloud.z - position.z) * n.z >= .14 - 1e-10);
    assert.ok(cloud.vx * n.x + cloud.vy * n.y + cloud.vz * n.z >= .1 - 1e-10);
  }
  const light = state.lights[0];
  assert.ok((light.x - position.x) * n.x + (light.y - position.y) * n.y >= .34);
});

test('shell bursts emphasize debris and dust without increasing global pools or leaving a long fireball', () => {
  for (const low of [false, true]) {
    const shell = createParticleState(), grenade = createParticleState();
    emitExplosionParticles(shell, position, 0, { low, radius: 9, style: 'tank-shell' });
    emitExplosionParticles(grenade, position, 0, { low, radius: 9 });
    assert.equal(shell.fragments.length, low ? 16 : 48);
    assert.ok(shell.clouds.find(cloud => cloud.kind === 'blast-flash').size >
      grenade.clouds.find(cloud => cloud.kind === 'blast-flash').size * 3);
    assert.ok(shell.fragments.some(particle => particle.size > .1));
    assert.ok(shell.clouds.length <= (low ? 6 : PARTICLE_LIMITS.clouds));
    advanceCombatParticles(shell, .4, () => .45, .4);
    assert.ok(!shell.clouds.some(cloud => ['blast-fire', 'blast-flash'].includes(cloud.kind)));
    assert.ok(shell.clouds.some(cloud => cloud.kind === 'blast-dust'));
    advanceCombatParticles(shell, 3.6, () => .45, 4);
    assert.equal(shell.fragments.length + shell.clouds.length + shell.lights.length, 0);
  }
});
