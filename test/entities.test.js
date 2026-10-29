import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEntityRegistry, registerUnit, registerWeapon, registerSoldier, createVehicleEntity, seatSoldier, occupiedVehicle,
  leaveGroundVehicle, selectControlledSoldier, controlledWeapon, createControlView, groundExit, vehicleCollider, damageVehicleEntity, resetEntities, captureAttackSource, createControlPoseView, occupiedSeat,
  soldierRifleMuzzle, SOLDIER_FIRE_HEIGHT } from '../src/entities.js';
import { circleBlocked, segmentClear } from '../src/core.js';
import { createRifleState } from '../src/rifle-action.js';
import { TANK_OBSERVATION } from '../src/player-tank.js';

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
  assert.equal(world.units.size, 2); assert.equal(world.soldiers.size, 5); assert.equal(world.weapons.size, 7);
  assert.equal(world.weapons.get(vehicle.machineGuns[0].id), vehicle.machineGuns[0]);
  assert.equal(occupiedVehicle(world, actors[0]), vehicle);
  assert.equal(controlledWeapon(world), vehicle.weapon);
  assert.equal(vehicle.seats[0].occupantId, actors[0].id);
  assert.equal(selectControlledSoldier(world, actors[3]), false, 'Y cannot silently cross into an autonomous unit');
});
test('explicit personal stance survives autonomous pose changes and restores its owned blend on takeover', () => {
  const { world, actors, vehicle } = fixture(), actor = actors[0];
  assert.equal(leaveGroundVehicle(world, actor, { x: 3, y: 0, z: 0 }), null);
  actor.nativeMotion = { posture: { crouched: 0, prone: 0 }, profile: { crouched: {}, prone: {} } };
  createControlPoseView(world).stance = 'prone';
  actor.rifle.ammo = 3;
  selectControlledSoldier(world, actors[1]);
  actor.stance = 'crouched'; actor.firingPose = 'kneeling';
  actor.nativeMotion.posture = { crouched: 1, prone: 0 };
  selectControlledSoldier(world, actor);
  assert.equal(actor.stance, 'prone');
  assert.deepEqual(actor.nativeMotion.posture, { crouched: 0, prone: 1 });
  assert.equal(actor.rifle.ammo, 3); assert.equal(actor.health, 100);
  assert.equal(seatSoldier(world, actor, vehicle, vehicle.seats[0].id), null);
  assert.equal(actor.manualStance, null);
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
test('only successful vehicle entry clears the original soldier traversal and weapon support', () => {
  const { world, actors, vehicle } = fixture(), actor = actors[0];
  leaveGroundVehicle(world, actor, { x: 3.2, y: 1, z: 0 });
  Object.assign(actor.traversal, { kind: 'jumping', velocity: 2, baseY: 0, elapsed: .2 });
  Object.assign(actor.weaponMount, { active: true, blend: 1, eyeOffset: -.3, contact: { x: 0, y: 1, z: 0 } });
  const traversal = structuredClone(actor.traversal), support = structuredClone(actor.weaponMount);
  assert.notEqual(seatSoldier(world, actor, vehicle, vehicle.seats[1].id), null);
  assert.deepEqual(actor.traversal, traversal);
  assert.deepEqual(actor.weaponMount, support);
  assert.equal(seatSoldier(world, actor, vehicle, vehicle.seats[0].id), null);
  assert.equal(actor.traversal.kind, 'grounded');
  assert.equal(actor.traversal.velocity, 0);
  assert.equal(actor.weaponMount.active, false);
  assert.equal(actor.weaponMount.blend, 0);
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
test('attack sources keep the original soldier, weapon, team and credit after switching, exiting and retirement', () => {
  const { world, actors, vehicle } = fixture();
  const source = captureAttackSource(world, actors[0]);
  assert.equal(source.weaponId, vehicle.weapon.id);
  assert.equal(source.vehicleId, vehicle.id);
  assert.equal(source.credit, 'player');
  selectControlledSoldier(world, actors[1]);
  leaveGroundVehicle(world, actors[0], { x: 4, y: 0, z: 0 });
  const rifleSource = captureAttackSource(world, actors[0]);
  assert.equal(rifleSource.weaponId, actors[0].rifle.id);
  assert.equal(rifleSource.credit, 'ally');
  assert.equal(rifleSource.vehicleId, null);
  actors[0].health = 0;
  world.soldiers.delete(actors[0].id);
  world.weapons.delete(actors[0].rifle.id);
  assert.equal(source.soldierId, actors[0].id);
  assert.equal(source.seatId, vehicle.seats[0].id);
  assert.equal(source.weaponId, vehicle.weapon.id);
  assert.equal(source.credit, 'player');
  assert.throws(() => { source.soldierId = actors[1].id; }, TypeError);
  assert.throws(() => captureAttackSource(world, actors[0]), /living registered/);
  assert.throws(() => captureAttackSource(world, actors[1], actors[3].rifle), /owned registered/);
  const ownerless = registerWeapon(world, {}, 'ownerless', null, 'infantry');
  assert.throws(() => captureAttackSource(world, actors[1], ownerless), /owned registered/);
});
test('support fire records the unit weapon but AI rifle hits record the actual personal rifle', () => {
  const { world, actors } = fixture();
  const formation = world.units.get(actors[3].unitId);
  formation.supportWeapon = registerWeapon(world, { ammo: 1 }, 'bravo:mortar', formation.id, 'mortar');
  actors[3].groundType = 'mortar';
  assert.equal(captureAttackSource(world, actors[3]).weaponId, formation.supportWeapon.id);
  assert.equal(captureAttackSource(world, actors[3], actors[3].rifle).weaponId, actors[3].rifle.id);
  registerUnit(world, { id: 'hostile', team: 'enemy' });
  const enemy = registerSoldier(world, { id: 'enemy', unitId: 'hostile', team: 'enemy', health: 100, groundType: 'infantry' });
  enemy.rifle = registerWeapon(world, {}, 'enemy:rifle', enemy.id, 'infantry');
  assert.equal(captureAttackSource(world, enemy).credit, 'enemy');
});
test('each soldier owns their foot stance and look pitch across Y rather than inheriting the old controller pose', () => {
  const { world, actors } = fixture(), pose = createControlPoseView(world);
  leaveGroundVehicle(world, actors[0], { x: 4, y: 0, z: 0 });
  leaveGroundVehicle(world, actors[1], { x: -4, y: 0, z: 0 });
  pose.stance = 'prone'; pose.pitch = -.9; pose.yaw = .8;
  assert.equal(pose.eyeHeight, .45);
  selectControlledSoldier(world, actors[1]);
  assert.equal(pose.stance, 'standing');
  assert.equal(pose.pitch, 0);
  assert.equal(pose.eyeHeight, 1.67);
  pose.stance = 'crouched'; pose.pitch = .2;
  assert.equal(pose.eyeHeight, 1.05);
  selectControlledSoldier(world, actors[0]);
  assert.equal(pose.stance, 'prone');
  assert.equal(pose.pitch, -.9);
  assert.equal(pose.yaw, .8);
  const before = structuredClone(world);
  for (let i = 0; i < 100; i++) void [pose.stance, pose.pitch, pose.yaw, pose.eyeHeight];
  assert.deepEqual(world, before, 'view reads never write simulation state');
});
test('tank aiming belongs to the original vehicle while foot pitch belongs to its crew member', () => {
  const { world, actors, vehicle } = fixture(), pose = createControlPoseView(world);
  pose.yaw = 1.1; pose.pitch = -.6;
  assert.equal(vehicle.turretYaw, 1.1); assert.equal(vehicle.turretPitch, -.6);
  assert.equal(actors[0].lookPitch, 0);
  assert.equal(pose.eyeHeight, TANK_OBSERVATION.commander.eyeHeight);
  selectControlledSoldier(world, actors[1]);
  assert.equal(pose.eyeHeight, TANK_OBSERVATION.gunner.eyeHeight);
  assert.equal(pose.pitch, -.6);
  selectControlledSoldier(world, actors[2]);
  assert.equal(pose.eyeHeight, 1.3);
  selectControlledSoldier(world, actors[0]);
  leaveGroundVehicle(world, actors[0], { x: 4, y: 0, z: 0 });
  assert.equal(pose.pitch, 0);
  pose.pitch = -.8; pose.stance = 'prone';
  assert.equal(vehicle.turretPitch, -.6);
  const before = { health: vehicle.health, ammo: vehicle.weapon.ammo };
  assert.equal(seatSoldier(world, actors[0], vehicle, vehicle.seats[0].id), null);
  assert.equal(pose.pitch, -.6, 'reboarding cannot overwrite cannon pitch with a ground look');
  assert.equal(pose.yaw, 1.1);
  assert.equal(pose.stance, 'standing', 'successful entry retains the existing seated-standing policy');
  assert.equal(actors[0].lookPitch, -.8);
  leaveGroundVehicle(world, actors[0], { x: 4, y: 0, z: 0 });
  assert.equal(pose.pitch, -.8);
  assert.deepEqual({ health: vehicle.health, ammo: vehicle.weapon.ammo }, before);
});
test('flight look belongs to aircraft attitude and keeps its existing pitch limits', () => {
  const world = createEntityRegistry();
  registerUnit(world, { id: 'air', type: 'plane', team: 'friendly' });
  const actor = registerSoldier(world, { id: 'pilot', unitId: 'air', team: 'friendly', health: 100, position: { x: 0, y: 0, z: 0 } });
  const plane = createVehicleEntity(world, { id: 'plane', unitId: 'air', team: 'friendly', type: 'plane', position: { x: 0, y: 30, z: 0 } });
  seatSoldier(world, actor, plane, plane.seats[0].id);
  world.control.unitId = 'air'; selectControlledSoldier(world, actor);
  const pose = createControlPoseView(world);
  pose.yaw = 1.2; pose.pitch = 2;
  assert.equal(plane.heading, 1.2);
  assert.equal(plane.pitch, .65);
  assert.equal(actor.lookPitch, 0);
  pose.pitch = -2;
  assert.equal(plane.pitch, -.7);
  resetEntities(world);
  assert.equal(pose.yaw, 0);
  assert.equal(pose.pitch, 0);
  assert.equal(pose.stance, 'standing');
  assert.equal(pose.eyeHeight, 1.67);
  assert.throws(() => { pose.yaw = 0; }, /living controlled/);
});
test('invalid or unavailable pose input is explicit and failed entry does not change foot stance', () => {
  const { world, actors, vehicle } = fixture(), pose = createControlPoseView(world);
  assert.throws(() => { pose.stance = 'prone'; }, /Seated/);
  assert.throws(() => { pose.pitch = Infinity; }, RangeError);
  assert.throws(() => { pose.yaw = NaN; }, RangeError);
  assert.throws(() => { pose.stance = '__proto__'; }, RangeError);
  leaveGroundVehicle(world, actors[0], { x: 4, y: 0, z: 0 });
  pose.stance = 'prone'; pose.pitch = -5;
  assert.equal(pose.pitch, -1.25);
  assert.match(seatSoldier(world, actors[0], vehicle, vehicle.seats[1].id), /占用/);
  assert.equal(pose.stance, 'prone');
  assert.equal(pose.pitch, -1.25);
  actors[0].health = 0;
  assert.throws(() => { pose.stance = 'standing'; }, /living controlled/);
});
test('driver observation is hull-relative and cannot steer the cannon or overwrite personal foot look', () => {
  const { world, actors, vehicle } = fixture(), pose = createControlPoseView(world);
  vehicle.heading = .4; pose.yaw = 1.8; pose.pitch = -.6;
  selectControlledSoldier(world, actors[2]);
  const driver = occupiedSeat(world);
  assert.equal(driver.role, 'driver');
  assert.equal(driver.controlsTurret, false);
  assert.equal(driver.canFire, false);
  assert.equal(pose.yaw, .4);
  assert.equal(pose.pitch, 0);
  pose.yaw = -.2; pose.pitch = .3;
  assert.ok(Math.abs(driver.viewYaw + .6) < 1e-10);
  assert.equal(driver.viewPitch, TANK_OBSERVATION.driver.pitchLimit);
  assert.equal(vehicle.turretYaw, 1.8);
  assert.equal(vehicle.turretPitch, -.6);
  assert.equal(actors[2].lookPitch, 0);
  vehicle.heading += .3;
  assert.ok(Math.abs(pose.yaw - .1) < 1e-10, 'driver view follows the hull rather than the stationary world-space cannon');
  selectControlledSoldier(world, actors[1]);
  assert.equal(pose.yaw, 1.8); assert.equal(pose.pitch, -.6);
  pose.yaw = 1.6; pose.pitch = -.25;
  selectControlledSoldier(world, actors[2]);
  assert.ok(Math.abs(pose.yaw - .1) < 1e-10);
  assert.equal(pose.pitch, TANK_OBSERVATION.driver.pitchLimit);
  const before = structuredClone(world);
  for (let i = 0; i < 100; i++) void [pose.yaw, pose.pitch, occupiedSeat(world)];
  assert.deepEqual(world, before);
});
test('driver seat observation survives exit/reboard and is isolated from another original vehicle', () => {
  const { world, actors, vehicle } = fixture(), pose = createControlPoseView(world);
  selectControlledSoldier(world, actors[2]);
  pose.yaw = .8; pose.pitch = -.2;
  const driver = vehicle.seats[2];
  leaveGroundVehicle(world, actors[2], { x: 4, y: 0, z: 0 });
  pose.yaw = -1; pose.pitch = .4;
  assert.equal(driver.viewYaw, TANK_OBSERVATION.driver.yawLimit); assert.equal(driver.viewPitch, -.2);
  assert.equal(seatSoldier(world, actors[2], vehicle, driver.id), null);
  assert.equal(pose.yaw, TANK_OBSERVATION.driver.yawLimit); assert.equal(pose.pitch, -.2);
  assert.equal(actors[2].lookPitch, .4);
  assert.equal(vehicle.turretYaw, 0); assert.equal(vehicle.turretPitch, 0);
  const other = createVehicleEntity(world, { id: 'tank-b', unitId: 'bravo', type: 'tank', team: 'friendly', position: { x: 20, y: 0, z: 0 } });
  seatSoldier(world, actors[3], other, other.seats[2].id);
  world.control.unitId = 'bravo'; selectControlledSoldier(world, actors[3]);
  assert.equal(pose.yaw, 0); assert.equal(pose.pitch, 0);
  pose.yaw = -.9; pose.pitch = -.5;
  assert.equal(driver.viewYaw, TANK_OBSERVATION.driver.yawLimit); assert.equal(driver.viewPitch, -.2);
  assert.equal(other.turretYaw, 0); assert.equal(other.turretPitch, 0);
});
test('driver takeover after crew casualties retains observation without inheriting cannon control', () => {
  const { world, actors, vehicle } = fixture(), pose = createControlPoseView(world);
  selectControlledSoldier(world, actors[2]); pose.yaw = .9; pose.pitch = -.15;
  selectControlledSoldier(world, actors[0]); pose.yaw = -.6; pose.pitch = -.8;
  damageVehicleEntity(world, vehicle, 130);
  assert.equal(actors[0].health, 0);
  selectControlledSoldier(world, actors[1]);
  damageVehicleEntity(world, vehicle, 120);
  assert.equal(actors[1].health, 0);
  assert.equal(selectControlledSoldier(world, actors[2]), true);
  assert.equal(pose.yaw, TANK_OBSERVATION.driver.yawLimit); assert.equal(pose.pitch, -.15);
  assert.equal(occupiedSeat(world).canFire, false);
  assert.equal(vehicle.turretYaw, -.6); assert.equal(vehicle.turretPitch, -.8);
  assert.equal(vehicle.health, 110);
});
test('driver limits wrap at north, cannot accumulate a full turn, and move only with the hull', () => {
  const { world, actors, vehicle } = fixture(), pose = createControlPoseView(world);
  selectControlledSoldier(world, actors[2]);
  const { yawLimit, pitchLimit } = TANK_OBSERVATION.driver;
  for (const heading of [0, Math.PI - .1, -Math.PI + .1, Math.PI * 4]) {
    vehicle.heading = heading;
    for (let step = 0; step < 100; step++) pose.yaw += .1;
    assert.ok(Math.abs(pose.yaw - heading - yawLimit) < 1e-10);
    for (let step = 0; step < 100; step++) pose.yaw -= .1;
    assert.ok(Math.abs(pose.yaw - heading + yawLimit) < 1e-10);
    pose.yaw = heading + 2 * Math.PI + .1;
    assert.ok(Math.abs(pose.yaw - heading - .1) < 1e-10);
    pose.pitch = 9; assert.equal(pose.pitch, pitchLimit);
    pose.pitch = -9; assert.equal(pose.pitch, -pitchLimit);
  }
  assert.equal(vehicle.turretYaw, 0); assert.equal(vehicle.turretPitch, 0);
  assert.equal(actors[2].lookPitch, 0);
});
test('AI rifle origins preserve both original local offsets across headings and bridge support', () => {
  for (const team of ['friendly', 'enemy']) for (const heading of [-Math.PI, -.8, 0, Math.PI / 2, 2.1]) {
    for (const position of [{ x: 0, y: 0, z: 0 }, { x: 13, y: .45, z: -16 }]) {
      const model = new THREE.Object3D();
      model.position.set(position.x, position.y, position.z); model.rotation.y = heading;
      model.updateMatrixWorld(true);
      const expected = new THREE.Vector3(.13, 1.39, team === 'friendly' ? -.871 : -1.07).applyMatrix4(model.matrixWorld);
      const origin = soldierRifleMuzzle({ position, heading, team });
      assert.ok(new THREE.Vector3(origin.x, origin.y, origin.z).distanceTo(expected) < 1e-10);
      assert.equal(origin.y, position.y + SOLDIER_FIRE_HEIGHT);
    }
  }
});
test('AI muzzle calculation needs no model, scale, matrices or renderer side effects', () => {
  const actor = { position: { x: 2, y: .45, z: 8 }, heading: .3, team: 'friendly' };
  Object.defineProperty(actor, 'model', { get() { throw new Error('render model must not be consulted'); } });
  const before = { ...actor.position };
  const origin = soldierRifleMuzzle(actor);
  assert.ok(['x', 'y', 'z'].every(axis => Number.isFinite(origin[axis])));
  assert.deepEqual(actor.position, before);
  for (const invalid of [{ ...actor, team: 'unknown' }, { ...actor, heading: Infinity },
    { ...actor, position: { x: 0, y: NaN, z: 0 } }]) assert.throws(() => soldierRifleMuzzle(invalid), RangeError);
});
