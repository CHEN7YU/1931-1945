import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { infantryEquipment, infantryLoadout, battleRoster, nanjingBattleRoster } from '../src/battle-roster.js';
import { sihangBattleRoster } from '../src/sihang-roster.js';
import { createEntityRegistry, registerUnit, registerSoldier, registerWeapon, captureAttackSource } from '../src/entities.js';
import { createCombatEvents } from '../src/combat-events.js';
import { attackSourceLabel } from '../src/combat-feedback.js';
import { createBattleStats } from '../src/battle-stats.js';
import { createRifleState, infantryWeaponProfile } from '../src/rifle-action.js';
import { createGrenadeDischargerModel, createGrenadeDischargerShellModel,
  updateGrenadeDischargerShellModel } from '../src/grenade-discharger-model.js';
import * as THREE from 'three';
import { GRENADE_DISCHARGER as RULES, createGrenadeDischarger, stowGrenadeDischarger,
  dischargerTargetAllowed, dischargerPriority, selectDischargerTargets,
  createDischargerShell, dischargerTrajectoryClear, loadDischargerRound, advanceDischargerShell,
  dischargerAccuracy, dischargerShellDirection, dischargerAimTrajectory, dischargerTrajectoryImpact } from '../src/grenade-discharger.js';

const soldier = (id, x, z, extra = {}) => ({ id, team: 'friendly', health: 100,
  targetKind: 'person', position: { x, y: 0, z }, ...extra });
const operator = () => soldier('operator', 0, -50, { team: 'enemy', unitId: 'enemy-0', formation: {} });
function ownedShell(target = { x: 0, y: .15, z: 50 }) {
  const registry = createEntityRegistry(), actor = operator(), weapon = createGrenadeDischarger();
  registerUnit(registry, { id: actor.unitId });
  registerSoldier(registry, actor);
  registerWeapon(registry, weapon, 'owned-tube', actor.id, 'grenade-discharger');
  const source = captureAttackSource(registry, actor, weapon);
  return { registry, actor, weapon, source, shell: createDischargerShell({ id: 'shell', source,
    start: { x: 0, y: .55, z: -50 }, target, firedAt: 10, random: () => .5 }) };
}

test('every logical 11/14/22-person Japanese squad has precisely two tubes and two type11 primaries', () => {
  for (const size of [11, 14, 22]) {
    const equipment = Array.from({ length: size }, (_, index) => infantryEquipment('enemy', index));
    assert.deepEqual(equipment.flatMap((item, index) => item.discharger ? [index] : []), [0, 1]);
    assert.deepEqual(equipment.flatMap((item, index) => item.role === 'machine-gunner' ? [index] : []), [8, 10]);
    for (const item of equipment.filter(item => item.role === 'machine-gunner')) {
      assert.equal(item.model, 'type11'); assert.equal(item.explosivePacks, 0);
      assert.equal(item.handGrenades, 1); assert.equal(item.discharger, false);
      assert.equal(infantryWeaponProfile(createRifleState(item.model)).automatic, true);
    }
    for (const item of equipment.filter(item => item.discharger)) {
      assert.equal(item.model, 'rifle'); assert.equal(item.handGrenades, 1);
      assert.equal(item.explosivePacks, 0);
    }
    assert.equal(equipment[9].role, 'sniper');
    assert.ok(equipment.slice(11).every(item => item.role === 'rifleman' && !item.discharger));
  }
});

test('all maps retain roster populations and aircraft-three; shield sappers have only their installation charge', () => {
  for (const roster of [battleRoster(), nanjingBattleRoster(), sihangBattleRoster()]) {
    for (const formation of roster.filter(formation => formation.team === 'enemy')) {
      const equipment = Array.from({ length: formation.memberCount ?? 11 }, (_, index) =>
        infantryEquipment('enemy', index, formation.type, formation));
      const normal = formation.type === 'infantry' && !formation.sihangDemolition;
      assert.equal(equipment.filter(item => item.discharger).length, normal ? 2 : 0);
      assert.equal(equipment.filter(item => item.model === 'type11').length, normal ? 2 : 0);
      if (formation.sihangDemolition) {
        assert.equal(equipment.length, 20);
        assert.ok(equipment.every(item => item.unarmed && item.demolitionCharge &&
          item.explosivePacks === 0 && item.handGrenades === 0 && !item.discharger));
      }
      if (formation.type === 'plane') assert.equal(formation.memberCount, 3);
    }
  }
  assert.deepEqual(infantryLoadout('friendly', 0), { role: 'mortarman', model: 'rifle' });
  assert.deepEqual(infantryLoadout('friendly', 8), { role: 'rifleman', model: 'rifle' });
  assert.deepEqual(infantryLoadout('friendly', 10), { role: 'machine-gunner', model: 'zb26' });
  assert.equal(infantryWeaponProfile(createRifleState('rifle')).automatic, false);
});

test('occupied cannon, heavy/AA MG, deployed mortar and stationary LMG precede player infantry', () => {
  const gunner = soldier('fixed', 0, 100, { emplacementId: 'cannon' });
  const points = new Map([['cannon', { team: 'friendly', operatorId: gunner.id }]]);
  const mortar = soldier('mortar', 0, 80, { mortar: { phase: 'ready' } });
  const lmg = soldier('lmg', 0, 10, { rifle: { model: 'zb26' }, locomotion: { speed: 0 } });
  const player = soldier('player', 0, 0, { playerUnit: true });
  const rifle = soldier('rifle', 0, -20);
  const targets = selectDischargerTargets(operator(), [rifle, player, lmg, mortar, gunner], points, {});
  assert.deepEqual(targets.map(item => item.target.id), ['fixed', 'mortar', 'lmg', 'player', 'rifle']);
  points.get('cannon').operatorId = null;
  assert.equal(dischargerPriority(gunner, points), 4, 'vacant gun is not a priority target');
  assert.equal(dischargerPriority({ ...lmg, locomotion: { speed: 3 } }, points), 4);
  assert.equal(dischargerPriority({ ...lmg, weaponMount: { active: true }, locomotion: { speed: 3 } }, points), 2);
  assert.equal(dischargerPriority({ ...lmg, stance: 'crouched', locomotion: { speed: 3 } }, points), 2);
});

test('no neutral civilians, dead/vehicle targets, assembly fire or gate-to-dock transition bypass', () => {
  const actor = operator();
  assert.equal(dischargerTargetAllowed(actor, soldier('civilian', 0, 0, { team: 'civilian' })), false);
  for (const target of [soldier('dead', 0, 0, { health: 0 }), soldier('tank', 0, 0, { vehicleId: 'tank' }),
    soldier('close', 0, -40), soldier('far', 0, 200)]) assert.equal(dischargerTargetAllowed(actor, target), false);
  assert.equal(dischargerTargetAllowed(actor, soldier('bank', 0, 40), { sihang: true }), false);
  assert.equal(dischargerTargetAllowed(actor, soldier('margin', 0, 33), { sihang: true }), false);
  assert.equal(dischargerTargetAllowed(actor, soldier('north', 0, 4), { sihang: true }), true);
  assert.equal(dischargerTargetAllowed(actor, soldier('safe', 0, 0), { eastAssembly: true }), false);
  assert.equal(dischargerTargetAllowed(actor, soldier('dock', 0, -30), { nanjingStage: 'withdrawal' }), false);
  assert.equal(dischargerTargetAllowed(actor, soldier('gate', 0, 27), { nanjingStage: 'withdrawal' }), true);
  assert.equal(dischargerTargetAllowed(actor, soldier('dock', 0, -30), { nanjingStage: 'dock-defense' }), true);
  actor.formation.sihangDemolition = true;
  assert.equal(dischargerTargetAllowed(actor, soldier('safe', 0, 0)), false);
});

test('real curved shells retain owned source, bounded spread, collision, one impact and paused clocks', () => {
  const { registry, source, shell, actor, weapon } = ownedShell();
  assert.equal(source.weaponClass, 'grenade-discharger');
  assert.equal(attackSourceLabel(source), '日军·八九式掷弹筒');
  const start = { ...shell.position };
  assert.equal(advanceDischargerShell(shell, 0, () => { throw Error('paused'); }), null);
  assert.deepEqual(shell.position, start);
  assert.ok(Math.hypot(shell.target.x, shell.target.z - 50) <= RULES.spread);
  assert.equal(advanceDischargerShell(shell, shell.duration / 2, () => null), null);
  assert.ok(shell.position.y > 15);
  registry.soldiers.delete(actor.id); registry.weapons.delete(weapon.id);
  const hit = { x: 1, y: 9, z: 2 };
  const event = advanceDischargerShell(shell, .1, () => hit);
  assert.deepEqual(event.position, hit); assert.deepEqual(event.source, source);
  assert.equal(event.collided, true);
  assert.equal(advanceDischargerShell(shell, 20, () => hit), null);
  const stats = createBattleStats(), events = createCombatEvents();
  stats.consume(events.publish('casualty', { source: event.source,
    target: { kind: 'soldier', id: 'victim', team: 'friendly', unitId: 'friendly-0' }, health: 0 }, 20));
  assert.equal(stats.snapshot[0].kills['grenade-discharger'], 1);
});

test('obstructed trajectories reject before firing, clear trajectories actually reach the target', () => {
  const { shell } = ownedShell();
  assert.equal(dischargerTrajectoryClear(shell, () => ({ x: 0, y: 5, z: -40 })), false);
  assert.equal(shell.elapsed, 0); assert.equal(shell.active, true);
  assert.equal(dischargerTrajectoryClear(shell, () => null), true);
  let event = null;
  for (let i = 0; i < 1000 && shell.active; i++) event = advanceDischargerShell(shell, 1 / 60, () => null) ?? event;
  assert.deepEqual(event.position, shell.target); assert.equal(event.collided, false);
});

test('ammo/reload and active-shell caps use simulation time and never allocate new model geometry', () => {
  const weapon = createGrenadeDischarger();
  assert.equal(loadDischargerRound(weapon, 0, 0), false);
  weapon.phase = 'ready';
  assert.equal(loadDischargerRound(weapon, 0, RULES.activeLimit), false);
  for (let index = 0; index < 24; index++) {
    assert.equal(loadDischargerRound(weapon, index * RULES.reloadSeconds, 0), true);
    assert.equal(loadDischargerRound(weapon, index * RULES.reloadSeconds, 0), false);
  }
  assert.equal(weapon.ammo + weapon.reserve, 0);
  assert.equal(loadDischargerRound(weapon, 1000, 0), false);
  stowGrenadeDischarger(weapon);
  assert.equal(weapon.phase, 'carrying'); assert.equal(weapon.targetId, null); assert.equal(weapon.anchor, null);
  const geometries = new Set(), materials = new Set();
  for (let i = 0; i < 100; i++) {
    const view = createGrenadeDischargerModel();
    assert.equal(view.name, RULES.name);
    assert.ok(view.userData.discharger.muzzle);
    view.traverse(child => { if (child.isMesh) { geometries.add(child.geometry); materials.add(child.material); } });
    view.removeFromParent();
  }
  assert.equal(geometries.size, 6); assert.equal(materials.size, 2);
});

test('native integration uses actual collision/explosion, rifle fallback, ownership cleanup and bounded AI queries', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /if \(operateAIDischarger\(actor, dt\)\) continue/);
  assert.match(source, /dischargerQueryBudget = 2/);
  assert.match(source, /advanceDischargerShell\(shell, dt, \(from, to\) => traceDischargerSegment\(from, to, shell\)\)/);
  assert.match(source, /dischargerTrajectoryClear\(aimShell, traceDischargerSegment\)/);
  assert.match(source, /weapon\.rejected = 'target-occluded'; stowGrenadeDischarger\(weapon\); return false/);
  assert.match(source, /function finishActorDeath\(actor, source\)[\s\S]*?clearActorDischarger\(actor\)/);
  assert.match(source, /entities\.weapons\.delete\(actor\.discharger\.id\)/);
});

test('defined aiming probability means a real landing within three metres, not a random damage exemption', () => {
  const { source } = ownedShell(), target = { x: 15, y: .035, z: 70 }, start = { x: 0, y: .5, z: -50 };
  let seed = 1937, close = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let shot = 0; shot < 20000; shot++) {
    const shell = createDischargerShell({ id: `shell-${shot}`, source, start, target, firedAt: 0, accuracy: .25, random });
    const error = Math.hypot(shell.target.x - target.x, shell.target.z - target.z);
    if (shell.aim.closeAim) {
      close++; assert.ok(error >= .75 - 1e-8 && error <= 3 + 1e-8);
    } else assert.ok(error >= 8 - 1e-8 && error <= 18 + 1e-8);
    assert.equal(shell.damage, RULES.damage); assert.equal(shell.radius, RULES.radius);
    assert.deepEqual(shell.aim.intended, target);
  }
  assert.ok(Math.abs(close / 20000 - .25) < .01, `Measured landing probability ${close / 20000}`);
});

test('miss dispersion may strike an obstruction without being resampled into a perfect shot, while intended aim still requires clear trajectory', () => {
  const { shell } = ownedShell();
  assert.equal(shell.aim.closeAim, false);
  const original = JSON.stringify(shell);
  const aim = dischargerAimTrajectory(shell);
  assert.deepEqual(aim.target, shell.aim.intended);
  assert.equal(dischargerTrajectoryClear(aim, () => null), true);
  const blocked = { x: -2, y: 5, z: 12 };
  assert.deepEqual(dischargerTrajectoryImpact(shell, () => blocked).position, blocked);
  assert.equal(dischargerTrajectoryClear(aim, () => blocked), false, 'an actually blocked intended shot is not authorized');
  assert.equal(JSON.stringify(shell), original, 'planning cannot mutate or reroll the original miss');
});

test('long range, moving targets and suppressed operators reduce close-landing probability without rerolling aim during flight', () => {
  const actor = operator();
  actor.tactics = { suppressedUntil: 0 };
  const target = soldier('target', 0, 50, { locomotion: { speed: 0 } });
  assert.ok(Math.abs(dischargerAccuracy(actor, target, 0) - .24375) < 1e-9);
  const stationary = dischargerAccuracy(actor, target, 0);
  target.locomotion.speed = 2.7;
  assert.equal(dischargerAccuracy(actor, target, 0), stationary * .5);
  actor.tactics.suppressedUntil = 1;
  assert.equal(dischargerAccuracy(actor, target, 0), stationary * .5 * .6);
  assert.equal(dischargerAccuracy(actor, target, 1), stationary * .5);
  const { shell } = ownedShell(), frozen = { ...shell.target };
  target.position.x += 20;
  advanceDischargerShell(shell, .1, () => null);
  assert.deepEqual(shell.target, frozen, 'movement cannot steer an already fired projectile');
  assert.throws(() => dischargerAccuracy(actor, target, NaN), RangeError);
  assert.throws(() => createDischargerShell({ accuracy: NaN }), RangeError);
  assert.throws(() => createDischargerShell({ random: () => 1 }), RangeError);
});

test('Type 89 HE shell is a reusable 50mm elongated non-emissive model, with fuze and narrow markings, not a yellow ball', () => {
  const models = Array.from({ length: 16 }, createGrenadeDischargerShellModel), first = models[0];
  const geometries = new Set(), materials = new Set();
  for (const model of models) {
    assert.equal(model.name, 'type89-he-shell');
    model.traverse(node => {
      if (!node.isMesh) return;
      assert.notEqual(node.geometry.type, 'SphereGeometry');
      assert.equal(node.material.emissive.getHex(), 0);
      geometries.add(node.geometry); materials.add(node.material);
    });
  }
  assert.equal(geometries.size, 4); assert.equal(materials.size, 4);
  const bounds = new THREE.Box3().setFromObject(first), size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - .05) < .001 && Math.abs(size.y - .144) < .001);
  const { shell } = ownedShell();
  for (const phase of [0, .5, 1]) {
    shell.elapsed = shell.duration * phase;
    updateGrenadeDischargerShellModel(first, shell);
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(first.quaternion);
    const expected = dischargerShellDirection(shell);
    assert.ok(forward.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z)) < 1e-9);
    const paused = first.quaternion.clone();
    updateGrenadeDischargerShellModel(first, shell);
    assert.ok(paused.angleTo(first.quaternion) < 1e-7, 'paused spin cannot accumulate');
    assert.deepEqual(first.position.toArray(), [shell.position.x, shell.position.y, shell.position.z]);
  }
  shell.elapsed = 0; assert.ok(dischargerShellDirection(shell).y > 0);
  shell.elapsed = shell.duration; assert.ok(dischargerShellDirection(shell).y < 0);
});
