import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createEntityRegistry, registerUnit, registerSoldier, createVehicleEntity, seatSoldier, captureAttackSource } from '../src/entities.js';
import { TANK_MACHINE_GUN, advanceTankMachineGun, tankMachineGunPose, tankCannonPose, tankHeading } from '../src/player-tank.js';
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
