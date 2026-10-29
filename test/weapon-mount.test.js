import test from 'node:test';
import assert from 'node:assert/strict';
import { aimSway } from '../src/sniper-aim.js';
import { WEAPON_MOUNT, createWeaponMount, mountCandidate, beginWeaponMount, releaseWeaponMount,
  advanceWeaponMount, mountedLook, mountStability } from '../src/weapon-mount.js';

const p = { x: 0, y: 0, z: 0 };
const probe = point => ({ x: point.x, y: 1.16, z: point.z, normalY: 1 });
function mounted() {
  const state = createWeaponMount(), candidate = mountCandidate(p, 1.67, 0, probe);
  beginWeaponMount(state, candidate, p, 0, 0, 'standing');
  return state;
}

test('mount requires a reachable upward-facing surface at a compatible owned stance height', () => {
  assert.ok(mountCandidate(p, 1.67, 0, probe));
  assert.equal(mountCandidate(p, 1.67, 0, () => null), null);
  assert.equal(mountCandidate(p, 1.67, 0, point => ({ ...point, y: 1.2, normalY: 0 })), null);
  assert.equal(mountCandidate(p, .45, 0, probe), null);
  assert.equal(mountCandidate(p, 1.67, 0, () => ({ y: .5, normalY: 1 })), null);
  const upper = mountCandidate({ ...p, y: 3.2 }, 1.05, Math.PI / 2,
    point => ({ ...point, y: 4.08, normalY: 1 }));
  assert.ok(upper);
  assert.ok(Math.abs(upper.eyeOffset - (-.01)) < 1e-8);
});

test('a rounded sandbag edge can be reached without requiring a single exact mounting distance', () => {
  const candidate = mountCandidate(p, 1.67, 0, point => point.z > -.7 ? null : ({ ...point, y: 1.14, normalY: .9 }));
  assert.ok(candidate);
  assert.ok(candidate.contact.z <= -.7 && candidate.contact.z >= -WEAPON_MOUNT.maxReach);
  assert.equal(mountCandidate(p, 1.67, 0, point => point.z < -1 ? ({ ...point, y: 1.14, normalY: 1 }) : null), null);
});

test('settled support reduces actual aim sway and recoil, with stronger machine-gun recoil support but never zero recoil', () => {
  const state = mounted();
  advanceWeaponMount(state, .2, p, 'standing', true, probe);
  assert.equal(state.blend, 1);
  const stability = mountStability(state), machineGun = mountStability(state, true);
  const sway = aimSway(1, { scoped: true, holding: false, moving: false, stance: 'standing' });
  assert.ok(Math.abs(stability.sway - WEAPON_MOUNT.swayScale) < 1e-8);
  assert.ok(Math.abs(sway.pitch * stability.sway) < Math.abs(sway.pitch) / 4);
  assert.ok(machineGun.recoil < stability.recoil && machineGun.recoil > 0);
  assert.ok(stability.recoil <= .301);
  releaseWeaponMount(state);
  assert.deepEqual(mountStability(state), { sway: 1, recoil: 1 });
});

test('support constrains look including yaw wrapping without leaking its anchor into another soldier', () => {
  const state = mounted();
  const look = mountedLook(state, 20, 2);
  assert.ok(Math.abs(look.yaw) <= WEAPON_MOUNT.yawLimit);
  assert.equal(look.pitch, WEAPON_MOUNT.pitchLimit);
  state.yaw = Math.PI - .1;
  assert.ok(Math.abs(mountedLook(state, -Math.PI + .1, 0).yaw - (Math.PI + .1)) < 1e-8);
  assert.equal(createWeaponMount().active, false);
});

test('movement, stance/equipment changes and lost support cancel stability; zero-time pause is deterministic', () => {
  for (const [position, stance, available, trace] of [
    [{ ...p, x: .2 }, 'standing', true, probe], [p, 'crouched', true, probe],
    [p, 'standing', false, probe], [p, 'standing', true, () => null],
    [p, 'standing', true, point => ({ ...point, y: 1, normalY: 1 })],
  ]) {
    const state = mounted();
    advanceWeaponMount(state, .2, position, stance, available, trace);
    assert.equal(state.active, false);
    assert.deepEqual(mountStability(state), { sway: 1, recoil: 1 });
  }
  const state = mounted(), before = structuredClone(state);
  advanceWeaponMount(state, 0, p, 'standing', true, probe);
  assert.deepEqual(state, before);
  assert.throws(() => advanceWeaponMount(state, NaN, p, 'standing', true, probe), RangeError);
});
