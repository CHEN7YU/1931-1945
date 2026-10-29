import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Euler } from 'three';
import { createEntityRegistry, registerUnit, registerSoldier, createVehicleEntity, seatSoldier, captureAttackSource } from '../src/entities.js';
import { TANK_MACHINE_GUN, advanceTankMachineGun, tankMachineGunPose, tankCannonPose, tankHeading,
  TANK_OBSERVATION, tankObservationPose, tankConvergedDirection } from '../src/player-tank.js';
import { shotState } from '../src/core.js';
import { advanceOwnedWeapons } from '../src/weapon-simulation.js';
import { historicalVehicleModel } from '../src/vehicle-model.js';

function fixture() {
  const registry = createEntityRegistry();
  registerUnit(registry, { id: 'armor', team: 'friendly', type: 'tank', members: [] });
  const vehicle = createVehicleEntity(registry, { id: 'tank', unitId: 'armor', team: 'friendly', type: 'tank', position: new Vector3() });
  const crew = vehicle.seats.map((seat, index) => {
    const actor = registerSoldier(registry, { id: `crew-${index}`, unitId: 'armor', team: 'friendly', health: 100, position: new Vector3() });
    assert.equal(seatSoldier(registry, actor, vehicle, seat.id), null); return actor;
  });
  return { registry, vehicle, crew, gun: vehicle.machineGuns[0] };
}
test('closed commander and gunner eyes stay inside the turret; optics and driver do not share an exterior camera', () => {
  const { vehicle } = fixture();
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    vehicle.heading = heading; vehicle.position.set(13, 3, -9);
    for (const role of ['commander', 'gunner', 'driver']) {
      const normal = tankObservationPose(vehicle, role, false), zoom = tankObservationPose(vehicle, role, true);
      assert.ok(Math.abs(normal.y - vehicle.position.y - TANK_OBSERVATION[role].eyeHeight) < 1e-12);
      assert.ok(normal.y < vehicle.position.y + 2.16);
      assert.deepEqual({ x: normal.x, y: normal.y, z: normal.z }, { x: zoom.x, y: zoom.y, z: zoom.z });
      assert.ok(normal.fov >= zoom.fov);
      if (role === 'driver') assert.equal(Math.hypot(normal.x - 13, normal.z + 9), 0);
      else if (role === 'commander') assert.ok(Math.abs(Math.hypot(normal.x - 13, normal.z + 9) - Math.hypot(.3, .38)) < 1e-12);
    }
  }
  assert.equal(tankObservationPose(vehicle, 'commander', false).aperture, 'slit');
  assert.equal(tankObservationPose(vehicle, 'gunner', false).aperture, 'scope');
  assert.equal(tankObservationPose(vehicle, 'gunner', false).fov, 40);
  assert.equal(tankObservationPose(vehicle, 'gunner', true).fov, 24);
  assert.throws(() => tankObservationPose(vehicle, 'outside', false), RangeError);
});
test('gunner optics follow the trunnion and keep the real coax muzzle below the sight at every elevation', () => {
  const { vehicle } = fixture(), model = historicalVehicleModel('tank');
  for (const heading of [0, .8, -2]) for (const yaw of [-1, 0, 2]) for (const pitch of [-1.25, -.3, 0, .3, 1.25]) {
    Object.assign(vehicle, { heading, turretYaw: yaw, turretPitch: pitch });
    const eye = tankObservationPose(vehicle, 'gunner', false), shot = tankMachineGunPose(vehicle);
    model.rotation.y = heading; model.userData.turret.rotation.y = yaw - heading;
    model.userData.gun.rotation.x = pitch; model.updateMatrixWorld(true);
    assert.ok(model.getObjectByName('gunner-sight').getWorldPosition(new Vector3()).distanceTo(new Vector3(eye.x, eye.y, eye.z)) < 1e-10);
    const up = new Vector3(0, 1, 0).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
    const relative = new Vector3(shot.start.x - eye.x, shot.start.y - eye.y, shot.start.z - eye.z);
    assert.ok(Math.abs(relative.dot(up) + .115) < 1e-10);
    assert.ok(eye.y < vehicle.position.y + 2.16);
    const direction = new Vector3(0, 0, -1).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
    const target = new Vector3(eye.x, eye.y, eye.z).addScaledVector(direction, 35);
    const aim = tankConvergedDirection(shot, target);
    const ray = new Vector3(aim.x, aim.y, aim.z);
    const hit = new Vector3(shot.start.x, shot.start.y, shot.start.z).addScaledVector(ray,
      new Vector3(shot.start.x, shot.start.y, shot.start.z).distanceTo(target));
    assert.ok(hit.distanceTo(target) < 1e-10);
  }
});

test('crew automatically load the original cannon on its simulation clock without firing or touching the coax', () => {
  const { registry, vehicle, gun } = fixture(), coax = { ...gun };
  assert.equal(shotState(vehicle.weapon, 1, true), true);
  assert.equal(vehicle.weapon.ammo, 0);
  assert.equal(vehicle.weapon.reloadUntil, 4.8);
  const deadline = vehicle.weapon.reloadUntil;
  for (let frame = 0; frame < 100; frame++) advanceOwnedWeapons(registry, 0, 9);
  assert.equal(vehicle.weapon.reloadUntil, deadline, 'paused or repeated polling cannot restart loading');
  assert.equal(shotState(vehicle.weapon, 4.79, true), false);
  assert.equal(vehicle.weapon.reloadUntil, deadline);
  advanceOwnedWeapons(registry, .01, 4.8);
  assert.equal(vehicle.weapon.ammo, 1); assert.equal(vehicle.weapon.reloadUntil, 0);
  assert.deepEqual(gun, coax);
  assert.equal(shotState(vehicle.weapon, 4.8, true), true);
  vehicle.health = 0;
  advanceOwnedWeapons(registry, .1, 10);
  assert.equal(vehicle.weapon.ammo, 0, 'a destroyed tank does not receive loaded ammunition');
});
test('friendly coax fires repeatedly from a registered secondary weapon without consuming or refilling the cannon', () => {
  const { registry, vehicle, crew, gun } = fixture(), cannon = { ...vehicle.weapon };
  for (let shot = 0; shot < 100; shot++) assert.ok(advanceTankMachineGun(vehicle, crew[0], .01, shot * .101, true));
  assert.equal(gun.shots, 100); assert.equal(gun.ammo, 0);
  assert.equal(advanceTankMachineGun(vehicle, crew[0], .01, 11, true), null);
  assert.equal(gun.reloadUntil, 11 + TANK_MACHINE_GUN.reload);
  assert.equal(advanceTankMachineGun(vehicle, crew[1], .01, 12, true), null);
  assert.equal(gun.ammo, 0, 'Y does not refill a shared machine gun');
  assert.ok(advanceTankMachineGun(vehicle, crew[1], .01, 15, true));
  assert.equal(gun.ammo, 99); assert.deepEqual(vehicle.weapon, cannon);
  const source = captureAttackSource(registry, crew[1], gun);
  assert.equal(source.weaponId, gun.id); assert.equal(source.vehicleId, vehicle.id);
  assert.equal(source.weaponClass, 'tank-machine-gun');
});
test('driver, dead crew, released triggers and zero simulation steps cannot fire the machine gun', () => {
  const { vehicle, crew, gun } = fixture();
  assert.equal(advanceTankMachineGun(vehicle, crew[2], .01, 0, true), null);
  assert.equal(advanceTankMachineGun(vehicle, crew[0], 0, 0, true), null);
  assert.equal(advanceTankMachineGun(vehicle, crew[0], .01, 0, false), null);
  crew[0].health = 0;
  assert.equal(advanceTankMachineGun(vehicle, crew[0], .01, 0, true), null);
  assert.equal(gun.ammo, 100);
});
test('coax shots originate at the real independently turned and elevated barrel tip', () => {
  const { vehicle } = fixture(), model = historicalVehicleModel('tank');
  for (const [heading, yaw, pitch] of [[0, 0, 0], [.8, -.4, .2], [-2, 1.8, -.15]]) {
    Object.assign(vehicle, { heading, turretYaw: yaw, turretPitch: pitch });
    vehicle.position.set(3, .4, -7);
    model.position.copy(vehicle.position); model.rotation.y = heading;
    model.userData.turret.rotation.y = yaw - heading; model.userData.gun.rotation.x = pitch;
    model.updateMatrixWorld(true);
    const actual = model.getObjectByName('coax-muzzle').getWorldPosition(new Vector3()), point = tankMachineGunPose(vehicle).start;
    assert.ok(actual.distanceTo(new Vector3(point.x, point.y, point.z)) < 1e-8);
    const cannon = tankCannonPose(vehicle).start;
    assert.ok(model.getObjectByName('cannon-muzzle').getWorldPosition(new Vector3())
      .distanceTo(new Vector3(cannon.x, cannon.y, cannon.z)) < 1e-8);
  }
});
test('heading diagram distinguishes hull steering, turret and north relative to the actual camera', () => {
  const { vehicle } = fixture();
  vehicle.heading = Math.PI / 2; vehicle.turretYaw = 0;
  assert.deepEqual(tankHeading(vehicle, 0), { hull: -90, turret: -0, north: -0 });
  assert.ok(Math.abs(tankHeading(vehicle, Math.PI / 2).hull) < 1e-8);
  assert.ok(Math.abs(tankHeading(vehicle, Math.PI / 2).turret - 90) < 1e-8);
  assert.throws(() => tankHeading(vehicle, NaN), RangeError);
});
