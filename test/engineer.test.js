import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineerState, consumeEngineerMaterial, selectEngineerEquipment, engineerObstacle,
  engineerFootprintBlocked, ENGINEER, engineerBuiltSpec } from '../src/engineer.js';
import { advanceConstruction, selectConstructionBlueprint } from '../src/construction.js';
import { infantryEquipment } from '../src/battle-roster.js';
import { createEmplacement, damageEmplacement, artilleryPositionTargets, fireEmplacement } from '../src/emplacements.js';

test('each whole infantry squad replaces one ordinary rifleman without changing dischargers, LMGs, sniper or demolition', () => {
  for (const team of ['friendly', 'enemy']) for (const count of [11, 14, 22]) {
    const equipment = Array.from({ length: count }, (_, index) => infantryEquipment(team, index));
    assert.equal(equipment.filter(member => member.role === 'engineer').length, 1);
    const engineer = equipment.find(member => member.role === 'engineer');
    assert.equal(engineer.model, 'rifle'); assert.equal(engineer.handGrenades, 1);
    assert.equal(engineer.explosivePacks, 1); assert.equal(engineer.discharger, false);
    if (team === 'enemy') {
      assert.equal(equipment.filter(member => member.discharger).length, 2);
      assert.equal(equipment.filter(member => member.role === 'machine-gunner').length, 2);
      assert.equal(equipment[9].role, 'sniper');
    }
  }
  for (let index = 0; index < 20; index++)
    assert.equal(infantryEquipment('enemy', index, 'infantry', { sihangDemolition: true }).unarmed, true);
});

test('an engineer needs twenty continuous simulation seconds and pause never spends materials', () => {
  const engineer = createEngineerState();
  selectConstructionBlueprint(engineer.construction, 'builder');
  const input = { builderId: 'builder', position: { x: 0, y: 0, z: 0 }, candidate: { x: 0, y: 0, z: -3.2 },
    holding: true, allowed: true, buildSeconds: ENGINEER.buildSeconds };
  assert.equal(advanceConstruction(engineer.construction, input, 19.99, () => null).completed, null);
  const before = JSON.stringify(engineer);
  advanceConstruction(engineer.construction, input, 0, () => null);
  assert.equal(JSON.stringify(engineer), before);
  const result = advanceConstruction(engineer.construction, input, .01, () => null);
  assert.equal(result.completed.builderId, 'builder');
  assert.equal(engineer.kits, 2, 'only successful emplacement registration may spend the kit');
  consumeEngineerMaterial(engineer, 'maxim24', 'gun-1');
  assert.deepEqual(engineer.materials, { maxim24: 0, bofors75: 1 });
  assert.throws(() => consumeEngineerMaterial(engineer, 'maxim24', 'gun-2'), /unspent material/);
  selectEngineerEquipment(engineer);
  assert.equal(engineer.selected, 'bofors75'); assert.equal(engineer.kits, 1);
  consumeEngineerMaterial(engineer, 'bofors75', 'cannon-1');
  assert.equal(engineer.kits, 0);
  selectEngineerEquipment(engineer);
  assert.equal(engineer.kits, 0, 'switching tools never refills either material');
});

test('construction interruption and another owner cannot inherit the first engineers progress', () => {
  const engineer = createEngineerState(), state = engineer.construction;
  selectConstructionBlueprint(state, 'builder');
  const input = { builderId: 'builder', position: { x: 0, y: 0, z: 0 },
    candidate: { x: 0, y: 0, z: -3.2 }, holding: true, allowed: true, buildSeconds: 20 };
  advanceConstruction(state, input, 19, () => null);
  advanceConstruction(state, { ...input, holding: false }, .05, () => null);
  assert.equal(state.progress, 0); assert.equal(engineer.kits, 2);
  advanceConstruction(state, input, 19, () => null);
  const result = advanceConstruction(state, { ...input, builderId: 'another-builder' }, 1, () => null);
  assert.equal(result.completed, null); assert.equal(state.progress, 0);
});

test('placement footprint detects thin walls, oriented walls and people without blocking the supporting floor', () => {
  const footprint = engineerObstacle('build', { x: 0, y: 8.4, z: 0 }, .7, 'bofors75');
  assert.equal(engineerFootprintBlocked(footprint, { minX: -.01, maxX: .01, minZ: -3, maxZ: 3,
    minY: 8.4, height: 12 }), true);
  assert.equal(engineerFootprintBlocked(footprint, { minX: -8, maxX: 8, minZ: -8, maxZ: 8, height: 8.4 }), false);
  assert.equal(engineerFootprintBlocked(footprint, { minX: 15, maxX: 16, minZ: 15, maxZ: 16, height: 12 }), false);
  assert.equal(engineerFootprintBlocked(footprint, { circular: true, cx: 0, cz: 0, radius: .45,
    minX: -.45, maxX: .45, minZ: -.45, maxZ: .45, minY: 8.4, height: 10 }), true);
});

test('built equipment keeps its engineer, squad, faction and original material identity', () => {
  for (const team of ['friendly', 'enemy']) {
    const actor = { id: `${team}-engineer`, unitId: `${team}-squad`, team, engineer: createEngineerState() };
    const spec = engineerBuiltSpec(actor, { x: 4, y: 0, z: 3 }, 1.2);
    assert.equal(spec.builderId, actor.id); assert.equal(spec.builderUnitId, actor.unitId);
    const point = createEmplacement(spec);
    assert.equal(point.team, team); assert.equal(point.engineerBuilt, true);
    assert.equal(point.weapon.ammo, 200);
    actor.engineer.selected = 'bofors75';
    assert.notEqual(engineerBuiltSpec(actor, { x: 4, y: 0, z: 3 }, 1.2).id, spec.id);
  }
});

test('real artillery positions remain targets when unmanned and stop firing when actually destroyed', () => {
  const point = createEmplacement({ id: 'cannon', profile: 'bofors75', x: 0, z: 20, heading: 0 });
  assert.equal(artilleryPositionTargets([point], () => 0).length, 1);
  const source = { team: 'enemy', soldierId: 'gunner', weaponId: 'tank-gun' };
  assert.equal(damageEmplacement(point, 180, source, 1), 180);
  assert.equal(point.health, 60);
  assert.equal(damageEmplacement(point, 180, { team: 'friendly' }, 1), 0);
  assert.equal(damageEmplacement(point, 180, source, 2), 60);
  assert.equal(artilleryPositionTargets([point], () => 0).length, 0);
  point.operatorId = 'crew';
  assert.equal(fireEmplacement(point, 3), false);
  assert.equal(point.lastDamage.source.weaponId, source.weaponId);
});
