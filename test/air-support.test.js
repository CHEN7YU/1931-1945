import test from 'node:test';
import assert from 'node:assert/strict';
import { AIR_SUPPORT, advanceAirSupport, createAirSupport } from '../src/air-support.js';
import { createCombatEvents } from '../src/combat-events.js';

test('reusable strafing passes aim downward at living troops, observe cover and obey ceasefire', () => {
  const target = { id: 'defender', health: 100, position: { x: -10, y: 8, z: 0 } };
  for (const fps of [30, 60, 120]) {
    const state = createAirSupport(), position = { x: 0, y: 28, z: 140 }, shots = [];
    let previous = null;
    for (let frame = 0; frame < fps * 60; frame++) {
      const shot = advanceAirSupport(state, position, 1 / fps, [target], target.position, () => true);
      if (previous) assert.ok(Math.hypot(position.x - previous.x, position.z - previous.z) < 23 / fps,
        'circling must remain continuous without teleporting between strafing passes');
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

test('three staggered aircraft circle, independently strafe ground troops and retask without teleporting', () => {
  const target = { id: 'defender', health: 100, position: { x: -10, y: 0, z: 0 } };
  const aircraft = Array.from({ length: AIR_SUPPORT.count }, (_, index) => ({
    state: createAirSupport(index), position: { x: 0, y: 0, z: 0 }, shotFrames: [],
  }));
  assert.equal(aircraft.length, 3);
  for (let frame = 0; frame < 3600; frame++) {
    for (const plane of aircraft) {
      const previous = plane.state.initialized ? { ...plane.position } : null;
      const shot = advanceAirSupport(plane.state, plane.position, 1 / 60, [target], target.position, () => true);
      if (shot) {
        plane.shotFrames.push(frame);
        const yawError = Math.atan2(Math.sin(shot.yaw - plane.state.heading), Math.cos(shot.yaw - plane.state.heading));
        assert.ok(Math.abs(yawError) < .6, 'guns fire into the forward cone, not sideways or behind the aircraft');
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

test('aircraft automatic shots retain original source and use the shared combat event contract', () => {
  const source = { credit: 'enemy', team: 'enemy', unitId: 'enemy-9', soldierId: 'pilot',
    weaponId: 'aircraft-gun', weaponClass: 'plane', squadId: 'enemy-9', unitName: 'fighter' };
  const event = createCombatEvents().publish('shot', { source, weaponType: 'plane',
    start: { x: 0, y: AIR_SUPPORT.altitude, z: 40 }, end: { x: 0, y: 0, z: 0 },
    automatic: true, muzzle: true, sound: 'shot' }, 1);
  assert.equal(event.automatic, true);
  assert.equal(event.source.weaponClass, 'plane');
});
