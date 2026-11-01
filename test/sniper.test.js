import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BREATH, createBreathState, advanceBreath, aimSway } from '../src/sniper-aim.js';
import { createRifleState, infantryWeaponProfile, shootRifle, advanceRifle, reloadRifle, rifleReloadSeconds } from '../src/rifle-action.js';
import { rifleModel, rifleWorldModel, syncWorldWeapon, updateRifleModel } from '../src/rifle-model.js';
import { soldierModel } from '../src/world.js';
import { createAIRifleControl, attemptAIRifleShot } from '../src/ai-rifle.js';

test('sniper retains five-round owned bolt actions, mechanical cues and queued reload without instant refills', () => {
  const rifle = createRifleState('sniper'), profile = infantryWeaponProfile(rifle);
  assert.equal(profile.automatic, false);
  assert.equal(profile.scoped, true);
  assert.ok(Math.abs(Math.tan(72 * Math.PI / 360) / Math.tan(profile.aimFov * Math.PI / 360) - 4.59) < .02);
  for (let shot = 1; shot <= 5; shot++) {
    assert.equal(shootRifle(rifle), true);
    assert.equal(shootRifle(rifle), false);
    assert.equal(rifle.ammo, 5 - shot);
    if (shot === 5) assert.equal(reloadRifle(rifle), true);
    assert.deepEqual(advanceRifle(rifle, profile.cycleSeconds), ['unlock', 'extract', 'close']);
  }
  assert.equal(rifle.action, 'reload');
  advanceRifle(rifle, rifleReloadSeconds(rifle) - .01);
  assert.equal(rifle.ammo, 0);
  advanceRifle(rifle, .02);
  assert.equal(rifle.ammo, 5);
  assert.equal(rifle.shots, 5);
});

test('breath is bounded, pauses exactly and exhaustion cannot pulse back on while Shift is held', () => {
  const breath = createBreathState(), other = createBreathState();
  advanceBreath(breath, 2, true, true);
  assert.ok(Math.abs(breath.remaining - 2 / 3) < 1e-8);
  const paused = structuredClone(breath);
  advanceBreath(breath, 0, true, true);
  assert.deepEqual(breath, paused);
  assert.equal(other.remaining, 1, 'state belongs to a soldier, not the camera');
  advanceBreath(breath, 4.01, true, true);
  assert.equal(breath.remaining, 0);
  assert.equal(breath.exhausted, true);
  for (let frame = 0; frame < 600; frame++) {
    advanceBreath(breath, 1 / 60, true, true);
    assert.equal(breath.holding, false);
  }
  assert.equal(breath.remaining, 1);
  advanceBreath(breath, .01, false, true);
  advanceBreath(breath, .01, true, true);
  assert.equal(breath.holding, true);
});

test('breath recovery, blocked equipment and timestep invariance use simulation time', () => {
  for (const hz of [30, 60, 144]) {
    const breath = createBreathState();
    for (let frame = 0; frame < hz * 3; frame++) advanceBreath(breath, 1 / hz, true, true);
    assert.ok(Math.abs(breath.remaining - .5) < 1e-8);
    for (let frame = 0; frame < hz; frame++) advanceBreath(breath, 1 / hz, true, false);
    assert.ok(Math.abs(breath.remaining - .75) < 1e-8);
    assert.equal(breath.holding, false);
  }
  const exhausted = { remaining: 0, holding: false, exhausted: true };
  advanceBreath(exhausted, BREATH.recoverSeconds * .2, false, true);
  advanceBreath(exhausted, .01, true, true);
  assert.equal(exhausted.holding, false, 'releasing too early does not bypass recovery threshold');
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceBreath(createBreathState(), dt, true, true), RangeError);
});

test('deterministic scope sway is steadier with breath, crouch or prone and worse while moving', () => {
  const sample = overrides => aimSway(1, { scoped: true, holding: false, moving: false, stance: 'standing', ...overrides });
  const normal = sample({});
  assert.ok(Math.abs(sample({ holding: true }).pitch) < Math.abs(normal.pitch) / 5);
  assert.ok(Math.abs(sample({ stance: 'crouched' }).pitch) < Math.abs(normal.pitch));
  assert.ok(Math.abs(sample({ stance: 'prone' }).pitch) < Math.abs(sample({ stance: 'crouched' }).pitch));
  assert.ok(Math.abs(sample({ moving: true }).pitch) > Math.abs(normal.pitch));
  assert.deepEqual(sample({}), normal);
  assert.throws(() => sample({ stance: 'unknown' }), RangeError);
});

test('first-person and both world LODs share scope geometry without duplicating rifles on pooled switches', () => {
  const state = createRifleState('sniper'), first = rifleModel(state), second = rifleModel(state);
  assert.ok(first.getObjectByName('sniper-scope'));
  assert.equal(first.getObjectByName('sniper-scope').children[0].geometry,
    second.getObjectByName('sniper-scope').children[0].geometry);
  const original = rifleModel();
  assert.equal(original.getObjectByName('sniper-scope'), undefined);
  for (const detail of ['near', 'far']) {
    const model = rifleWorldModel(detail, state);
    const attachment = new THREE.Object3D(); attachment.name = 'unrelated-attachment'; model.add(attachment);
    for (const key of ['sniper', 'zb26', 'sniper', 'type11', 'rifle', 'sniper']) {
      syncWorldWeapon(model, createRifleState(key));
      assert.equal(model.children.filter(child => child.name === 'sniper-scope').length, key === 'sniper' ? 1 : 0);
      assert.equal(model.children.filter(child => child.name === 'light-machine-gun').length, ['zb26', 'type11'].includes(key) ? 1 : 0);
      assert.equal(model.getObjectByName('rifleBody').visible, ['rifle', 'sniper'].includes(key));
      assert.equal(attachment.visible, true);
    }
    assert.ok(soldierModel(true, detail, 'sniper').children.length > 2);
    assert.ok(soldierModel(false, detail, 'sniper').children.length > 2);
  }
  state.ammo = 0; reloadRifle(state); advanceRifle(state, 1);
  updateRifleModel(first, state);
  assert.equal(first.userData.rifle.clip.getObjectByName('charger').visible, false, 'scope-equipped rifle uses loose loading, not a charger through the optic');
});

test('AI snipers retain real line-of-sight and movement gating rather than gaining automatic hits', () => {
  const actor = { health: 100, vehicleId: null, nextFire: 0, rifle: createRifleState('sniper'),
    aiRifle: createAIRifleControl(), locomotion: { speed: 0, sprinting: false, aimRecovery: 0 } };
  const fire = (now, confirmShot = () => 50) => attemptAIRifleShot(actor, { now, targetId: 'target',
    mayFire: true, postureSettled: true, suppressed: false, confirmShot });
  assert.equal(fire(0, () => null), false);
  actor.locomotion.speed = 1;
  assert.equal(fire(.1), false);
  actor.locomotion.speed = 0;
  for (let frame = 0; frame < 20 && actor.rifle.shots === 0; frame++) fire(.2 + frame * .1);
  assert.equal(actor.rifle.shots, 1);
  assert.equal(actor.rifle.ammo, 4);
});
