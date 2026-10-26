import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityRegistry, registerUnit, registerWeapon, registerSoldier, createVehicleEntity, seatSoldier, occupiedVehicle,
  leaveGroundVehicle, selectControlledSoldier, controlledWeapon, createControlView, groundExit, vehicleCollider, damageVehicleEntity, resetEntities } from '../src/entities.js';
import { circleBlocked, segmentClear } from '../src/core.js';
import { createRifleState } from '../src/rifle-action.js';

function fixture() {
  const world = createEntityRegistry();
  for (const id of ['alpha', 'bravo']) registerUnit(world, { id, team: 'friendly', members: [], type: id === 'alpha' ? 'tank' : 'infantry', squadId: id });
  const actors = Array.from({ length: 5 }, (_, i) => {
    const actor = registerSoldier(world, { id: `s${i}`, unitId: i < 3 ? 'alpha' : 'bravo', team: 'friendly', groundType: 'infantry',
      health: 100, position: { x: i * 2, y: 0, z: 0 }, rifle: createRifleState() });
    registerWeapon(world, Object.assign(actor.rifle, { nextShot: 0, reloadUntil: 0 }), `${actor.id}:rifle`, actor.id, 'infantry');
    world.units.get(actor.unitId).members.push(actor);
    return actor;
  });
  const vehicle = createVehicleEntity(world, { id: 'tank-a', type: 'tank', team: 'friendly', unitId: 'alpha', position: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < 3; i++) assert.equal(seatSoldier(world, actors[i], vehicle, vehicle.seats[i].id), null);
  world.control.unitId = 'alpha'; selectControlledSoldier(world, actors[0]);
  return { world, actors, vehicle };
}
test('unit, person, weapon, vehicle and seat identities have independent owners', () => {
  const { world, actors, vehicle } = fixture();
  assert.equal(world.units.size, 2); assert.equal(world.soldiers.size, 5); assert.equal(world.weapons.size, 6);
  assert.equal(occupiedVehicle(world, actors[0]), vehicle);
  assert.equal(controlledWeapon(world), vehicle.weapon);
  assert.equal(vehicle.seats[0].occupantId, actors[0].id);
  assert.equal(selectControlledSoldier(world, actors[3]), false, 'Y cannot silently cross into an autonomous unit');
});
test('Y seat transfer and F ground exit/reboard preserve hull, cannon and personal rifle state', () => {
  const { world, actors, vehicle } = fixture(), view = createControlView(world);
  actors[0].rifle.ammo = 3; vehicle.weapon.ammo = 0; vehicle.weapon.reloadUntil = 2.7; vehicle.health = 190; vehicle.heading = .8;
  selectControlledSoldier(world, actors[1]);
  assert.equal(view.ammo, 0); assert.equal(view.vehicleHealth, 190);
  selectControlledSoldier(world, actors[0]);
  assert.equal(leaveGroundVehicle(world, actors[0], { x: 3.2, y: 0, z: 0 }), null);
  assert.equal(view.type, 'infantry'); assert.equal(view.ammo, 3); assert.equal(actors[0].targetKind, 'person');
  assert.equal(world.vehicles.size, 1); assert.equal(vehicle.health, 190); assert.equal(vehicle.weapon.ammo, 0);
  assert.equal(vehicle.weapon.reloadUntil, 2.7);
  assert.equal(seatSoldier(world, actors[0], vehicle, vehicle.seats[0].id), null);
  assert.equal(view.type, 'tank'); assert.equal(view.ammo, 0); assert.equal(vehicle.heading, .8);
  assert.equal(view.vehicleHealth, 190);
});
test('blocked exits are atomic and cannot create infantry inside a vehicle or release its seat', () => {
  const { world, actors, vehicle } = fixture();
  const seat = actors[0].seatId;
  assert.equal(groundExit(vehicle, () => false, () => 0), null);
  assert.match(leaveGroundVehicle(world, actors[0], null), /受阻/);
  assert.equal(actors[0].seatId, seat); assert.equal(vehicle.seats[0].occupantId, actors[0].id);
  const exit = groundExit(vehicle, (point, from) => !circleBlocked(point.x, point.z, .42, [vehicleCollider(vehicle)]) &&
    segmentClear(from, point, .42, []), () => .45);
  assert.equal(exit.y, .45); assert.ok(exit.x > 2.5);
  assert.equal(leaveGroundVehicle(world, actors[0], exit), null);
});
test('hull damage is independent of the selected member; destruction kills only seated crew', () => {
  const { world, actors, vehicle } = fixture();
  leaveGroundVehicle(world, actors[0], { x: 3.2, y: 0, z: 0 });
  const result = damageVehicleEntity(world, vehicle, 90);
  assert.equal(result.damage, 90); assert.equal(vehicle.health, 270); assert.equal(actors[0].health, 100);
  const destroyed = damageVehicleEntity(world, vehicle, 270);
  assert.equal(destroyed.casualties.length, 2);
  assert.equal(actors[0].health, 100, 'ground crew are not implicitly killed by the abandoned vehicle being destroyed');
  assert.equal(actors[3].health, 100); assert.equal(actors[4].health, 100);
  assert.equal(world.control.soldierId, actors[0].id);
});
test('two independent friendly units keep resources and positions when the controller changes', () => {
  const { world, actors, vehicle } = fixture();
  const before = structuredClone(actors.slice(3).map(actor => ({ position: actor.position, health: actor.health, ammo: actor.rifle.ammo })));
  selectControlledSoldier(world, actors[2]); vehicle.weapon.ammo--;
  assert.deepEqual(actors.slice(3).map(actor => ({ position: actor.position, health: actor.health, ammo: actor.rifle.ammo })), before);
  assert.equal(world.soldiers.size, 5);
  resetEntities(world);
  assert.equal(world.soldiers.size + world.weapons.size + world.units.size + world.vehicles.size, 0);
  assert.equal(world.control.soldierId, null);
});
test('returning crew do not repay old casualty thresholds or allow a replacement squad to claim their old vehicle', () => {
  const { world, actors, vehicle } = fixture();
  damageVehicleEntity(world, vehicle, 130);
  assert.equal(actors[0].health, 0);
  assert.equal(vehicle.crewLossLevel, 1);
  assert.equal(damageVehicleEntity(world, vehicle, 1).casualties.length, 0);
  leaveGroundVehicle(world, actors[1], { x: 3.2, y: 0, z: 0 });
  const replacement = registerSoldier(world, { id: 'new-soldier', unitId: 'alpha', team: 'friendly', groundType: 'infantry',
    health: 100, position: { x: 3.2, y: 0, z: 0 }, rifle: createRifleState() });
  assert.match(seatSoldier(world, replacement, vehicle, vehicle.seats[1].id), /原有的车组/);
  assert.equal(seatSoldier(world, actors[1], vehicle, vehicle.seats[1].id), null);
  assert.equal(vehicle.health, 229);
});
