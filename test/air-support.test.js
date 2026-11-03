import test from 'node:test';
import assert from 'node:assert/strict';
import { AIR_SUPPORT, advanceAirSupport, createAirSupport, airSupportMuzzle } from '../src/air-support.js';
import { createCombatEvents } from '../src/combat-events.js';
import { TYPES } from '../src/core.js';
import { Euler, Vector3 } from 'three';

const spawn = state => ({ x: -AIR_SUPPORT.orbitWidth + AIR_SUPPORT.orbitWidth * Math.cos(state.phase),
  y: AIR_SUPPORT.altitude + state.index * 3, z: -AIR_SUPPORT.orbitLength * Math.sin(state.phase) });

test('reusable strafing passes aim downward at living troops, observe cover and obey ceasefire', () => {
  const target = { id: 'defender', health: 100, position: { x: -10, y: 8, z: 0 } };
  for (const fps of [30, 60, 120]) {
    const state = createAirSupport(), position = { x: 0, y: 28, z: 140 }, shots = [];
    let previous = null;
    for (let frame = 0; frame < fps * 60; frame++) {
      const shot = advanceAirSupport(state, position, 1 / fps, [target], target.position, () => true);
      if (previous) assert.ok(Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) <= TYPES.plane.speed / fps + 1e-8,
        'attack and recovery flight must remain continuous without teleporting');
      previous = { ...position };
      if (shot) shots.push(shot);
    }
    assert.ok(shots.length > 10);
    assert.ok(shots.every(shot => shot.pitch < 0));
    assert.ok(state.passes >= 2, 'aircraft should make subsequent passes');
    const before = state.shots;
    for (let frame = 0; frame < fps * 20; frame++) {
      assert.equal(advanceAirSupport(state, position, 1 / fps, [target], target.position, () => false), null);
    }
    assert.equal(state.shots, before);
    assert.equal(advanceAirSupport(state, position, 1, [target], target.position, () => true, false), null);
    assert.equal(advanceAirSupport(state, position, 1, [{ ...target, health: 0 }], target.position, () => true), null);
  }
});

test('three staggered aircraft fly pitched attack/recovery runs and retask without teleporting or rotating bullets toward targets', () => {
  const target = { id: 'defender', health: 100, position: { x: -10, y: 0, z: 0 } };
  const aircraft = Array.from({ length: AIR_SUPPORT.count }, (_, index) => {
    const state = createAirSupport(index);
    return { state, position: spawn(state), shotFrames: [] };
  });
  assert.equal(aircraft.length, 3);
  for (let frame = 0; frame < 14400; frame++) {
    for (const plane of aircraft) {
      const previous = plane.state.initialized ? { ...plane.position } : null;
      const shot = advanceAirSupport(plane.state, plane.position, 1 / 60, [target], target.position, () => true);
      if (shot) {
        plane.shotFrames.push(frame);
        assert.equal(shot.yaw, plane.state.heading);
        assert.equal(shot.pitch, plane.state.pitch);
        assert.ok(plane.state.pitch < 0, 'ground strafing requires a real nose-down aircraft pose');
        const modelAxis = new Vector3(0, 0, -1).applyEuler(
          new Euler(plane.state.pitch, plane.state.heading, plane.state.roll, 'YXZ'));
        const bulletAxis = new Vector3(-Math.sin(shot.yaw) * Math.cos(shot.pitch), Math.sin(shot.pitch),
          -Math.cos(shot.yaw) * Math.cos(shot.pitch));
        assert.ok(modelAxis.distanceTo(bulletAxis) < 1e-10);
      }
      if (previous) assert.ok(Math.hypot(plane.position.x - previous.x, plane.position.z - previous.z) < 26 / 60);
    }
    if (frame === 1800) target.position = { x: -66, y: 0, z: -80 };
  }
  assert.equal(new Set(aircraft.map(plane => plane.shotFrames[0])).size, 3, 'attack runs must be staggered');
  assert.ok(aircraft.every(plane => plane.shotFrames.length > 5 && plane.state.passes >= 2));
  assert.equal(new Set(aircraft.map(plane => plane.position.y)).size, 3);
  assert.throws(() => createAirSupport(3), RangeError);
});

test('the muzzle follows the displayed pitched and banked Ki-10 nose, and pause freezes the complete flight state', () => {
  const state = createAirSupport(1), position = spawn(state);
  Object.assign(state, { pitch: -.45, heading: 1.3, roll: -.2 });
  const expected = new Vector3(0, .17, -3.55).applyEuler(
    new Euler(state.pitch, state.heading, state.roll, 'YXZ')).add(new Vector3(position.x, position.y, position.z));
  assert.ok(expected.distanceTo(new Vector3(...Object.values(airSupportMuzzle(state, position)))) < 1e-10);
  const before = structuredClone({ state, position });
  assert.equal(advanceAirSupport(state, position, 0, [], position, () => true), null);
  assert.deepEqual({ state, position }, before);
});

test('aircraft automatic shots retain original source and use the shared combat event contract', () => {
  const source = { credit: 'enemy', team: 'enemy', unitId: 'enemy-9', soldierId: 'pilot',
    weaponId: 'aircraft-gun', weaponClass: 'plane', squadId: 'enemy-9', unitName: 'fighter' };
  const event = createCombatEvents().publish('shot', { source, weaponType: 'plane',
    start: { x: 0, y: AIR_SUPPORT.altitude, z: 40 }, end: { x: 0, y: 0, z: 0 },
    automatic: true, muzzle: true, sound: 'shot' }, 1);
  assert.equal(event.automatic, true);
  assert.equal(event.source.weaponClass, 'plane');
});
