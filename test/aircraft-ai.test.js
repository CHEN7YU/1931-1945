import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAircraftAI, AIRCRAFT_TURN } from '../src/aircraft-ai.js';
import { historicalVehicleModel, JAPANESE_AIRCRAFT_PROFILE } from '../src/vehicle-model.js';
import { Scene, Vector3 } from 'three';
import { createVehicleRenderer } from '../src/vehicle-renderer.js';

const plane = () => ({ team: 'enemy', health: 180, position: { x: 0, y: 35, z: -100 },
  heading: Math.PI, pitch: -.2, roll: 0, weapon: { type: 'plane', ammo: 60, nextShot: 0, reloadUntil: 0 },
  aiFlight: { phase: 'approach', until: 0, targetId: null, nextSense: 0 } });
const target = { id: 'friendly', team: 'friendly', health: 100, position: { x: 0, y: 0, z: 0 } };

test('Japanese aircraft turns, attacks visible enemies and retains ammo and simulation time', () => {
  const aircraft = plane(); let shots = 0;
  for (let frame = 1; frame <= 60 * 20; frame++) {
    if (advanceAircraftAI(aircraft, 1 / 60, frame / 60, { targets: [target], canFire: true, visible: () => true })) shots++;
    assert.ok([aircraft.position.x, aircraft.position.y, aircraft.position.z].every(Number.isFinite));
  }
  assert.ok(shots > 0);
  assert.ok(aircraft.position.y > 10);
  const before = structuredClone(aircraft);
  assert.equal(advanceAircraftAI(aircraft, 0, 20, { targets: [target], canFire: true, visible: () => true }), null);
  assert.deepEqual(aircraft, before);
});

test('aircraft cannot spend ammunition on blocked targets, dead pilots or friendlies', () => {
  for (const facts of [{ targets: [target], canFire: false, visible: () => true },
    { targets: [target], canFire: true, visible: () => false },
    { targets: [{ ...target, team: 'enemy' }], canFire: true, visible: () => true }]) {
    const aircraft = plane();
    for (let frame = 1; frame <= 120; frame++) assert.equal(advanceAircraftAI(aircraft, 1 / 60, frame / 60, facts), null);
    assert.equal(aircraft.weapon.ammo, 60);
  }
});

test('ground strafing fires only when the aircraft points at the real target elevation', () => {
  const aircraft = plane();
  let shots = 0;
  for (let frame = 1; frame <= 60 * 20; frame++) {
    const shot = advanceAircraftAI(aircraft, 1 / 60, frame / 60, {
      targets: [target], canFire: true, visible: () => true,
    });
    if (!shot) continue;
    shots++;
    const yaw = Math.atan2(aircraft.position.x - target.position.x, aircraft.position.z - target.position.z);
    const pitch = Math.atan2(target.position.y + 1.2 - aircraft.position.y,
      Math.hypot(target.position.x - aircraft.position.x, target.position.z - aircraft.position.z));
    assert.ok(Math.abs(Math.atan2(Math.sin(yaw - aircraft.heading), Math.cos(yaw - aircraft.heading))) <= .08);
    assert.ok(Math.abs(pitch - aircraft.pitch) <= .08);
  }
  assert.ok(shots > 0, 'a valid ground attack must shoot, not orbit indefinitely');
});

test('aircraft models keep separate faction identity and friendly detail metadata', () => {
  const friendly = historicalVehicleModel('plane'), enemy = historicalVehicleModel('plane', 'enemy');
  assert.equal(enemy.userData.profile.model, JAPANESE_AIRCRAFT_PROFILE.model);
  assert.equal(friendly.userData.profile.model, 'i-15bis');
  assert.equal(friendly.userData.details.wingRibs, true);
  assert.equal(friendly.userData.details.cockpitHarness, true);
  assert.notEqual(enemy.children[0].geometry, friendly.children[0].geometry);
  assert.ok(enemy.getObjectByName('propeller'));
});

test('unhit aircraft bank changes are continuous during target-free patrol and direction reversals', () => {
  for (const hz of [30, 60, 144]) {
    const aircraft = plane(), facts = { targets: [], canFire: false, visible: () => false };
    let largestStep = 0;
    for (let frame = 1; frame <= hz * 60; frame++) {
      const before = aircraft.roll;
      advanceAircraftAI(aircraft, 1 / hz, frame / hz, facts);
      const step = Math.abs(aircraft.roll - before);
      largestStep = Math.max(largestStep, step);
      assert.ok(step <= AIRCRAFT_TURN.bankRate / hz + 1e-12);
      assert.ok(Math.abs(aircraft.roll) <= .4);
      assert.equal(aircraft.health, 180);
      assert.equal(aircraft.weapon.ammo, 60);
    }
    assert.ok(largestStep > 0, 'patrol still banks rather than hiding the turn');
    const before = structuredClone(aircraft);
    advanceAircraftAI(aircraft, 0, 60, facts);
    assert.deepEqual(aircraft, before);
  }
});

test('edge return has hysteresis instead of oscillating at one boundary', () => {
  const aircraft = plane(), facts = { targets: [], canFire: false, visible: () => false };
  for (const [x, expected] of [[126, true], [124, true], [110, true], [104, false], [106, false], [124, false]]) {
    aircraft.position.x = x; aircraft.position.z = 0;
    advanceAircraftAI(aircraft, 1 / 60, 1, facts);
    assert.equal(aircraft.aiFlight.returningToArea, expected);
  }
});

test('banking does not twist the displayed aircraft nose away from its actual flight direction', () => {
  const renderer = createVehicleRenderer(new Scene());
  const aircraft = { ...plane(), id: 'japan-plane', type: 'plane', variant: null, turretYaw: 0, turretPitch: 0,
    position: new Vector3(0, 35, 0) };
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const pitch of [-.28, .22]) {
    for (const roll of [-.36, 0, .36]) {
      Object.assign(aircraft, { heading, pitch, roll });
      renderer.update([aircraft], 1);
      const model = renderer.model(aircraft.id);
      const forward = new Vector3(0, 0, -1).applyQuaternion(model.quaternion);
      const expected = new Vector3(-Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch));
      assert.ok(forward.distanceTo(expected) < 1e-12);
    }
  }
  renderer.clear();
});
