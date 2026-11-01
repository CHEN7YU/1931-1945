import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHI_HA, CHI_HA_MG, CHI_HA_MG_MOUNTS, japaneseArmorRoster, japaneseArmorSpawns,
  chiHaMuzzle, chiHaMachineGunPose, chiHaObjectiveDestination } from '../src/chi-ha.js';
import { chiHaModel, animateChiHa } from '../src/chi-ha-model.js';
import { advanceChiHaAI } from '../src/chi-ha-ai.js';
import { advanceChiHaMachineGuns } from '../src/chi-ha-machine-guns.js';
import { battleRoster, validateRoster, battleSpawn, armySummary, reinforcementDue } from '../src/battle-roster.js';
import { createEntityRegistry, registerUnit, registerSoldier, createVehicleEntity, seatSoldier,
  damageVehicleEntity, vehicleCollider } from '../src/entities.js';
import { createVehicleRenderer } from '../src/vehicle-renderer.js';
import { advanceOwnedWeapons } from '../src/weapon-simulation.js';
import { damageForTarget } from '../src/combat-targets.js';
import { moveGround, circleBlocked, segmentClear } from '../src/core.js';
import { createTankNavigation } from '../src/tank-navigation.js';

function fixture() {
  const registry = createEntityRegistry(), formation = japaneseArmorRoster()[0];
  registerUnit(registry, formation);
  const vehicle = createVehicleEntity(registry, { id: 'chiha-test', unitId: formation.id, type: 'tank',
    variant: CHI_HA.id, team: 'enemy', position: new THREE.Vector3() });
  const crew = vehicle.seats.map((seat, index) => {
    const actor = registerSoldier(registry, { id: `crew-${index}`, unitId: formation.id,
      team: 'enemy', health: 100, position: new THREE.Vector3() });
    assert.equal(seatSoldier(registry, actor, vehicle, seat.id), null);
    return actor;
  });
  formation.members = crew;
  return { registry, vehicle, crew, formation };
}
const target = { id: 'target', team: 'friendly', health: 100, targetKind: 'person', position: { x: 0, y: 0, z: -45 } };
function context(crew, extra = {}) {
  return { crew, canFire: true, targets: [target], objective: { x: 0, z: -80 }, visible: () => true,
    safeToFire: () => true, pathTo: (from, to) => [to],
    move: (p, dx, dz) => { p.x += dx; p.z += dz; }, ...extra };
}

test('one tank, one aircraft and eight infantry squads occupy exactly ten Japanese formation slots', () => {
  const roster = battleRoster();
  validateRoster(roster);
  assert.equal(roster.length, 20);
  assert.equal(roster.filter(unit => unit.team === 'enemy' && unit.type === 'infantry').length, 8);
  const support = roster.find(unit => unit.type === 'tank'), garages = japaneseArmorSpawns(), garage = garages[0];
  assert.equal(battleSpawn(support, [...garages, { team: 'enemy', kind: 'rally' }], [], [], false), garage);
  assert.equal(garage.kind, 'garage');
  roster.forEach(unit => { unit.members = Array.from({ length: unit.memberCount ?? 4 }, () => ({ health: 100 })); });
  assert.deepEqual(armySummary(roster, 'enemy'), { units: 10, rosterUnits: 10, alive: 96, vehicles: 2 });
  roster.find(unit => unit.team === 'enemy' && unit.type === 'infantry').type = 'tank';
  assert.throws(() => validateRoster(roster), /vehicle limit/);
});
test('four real crew own seats and hull damage remains independent of infantry health', () => {
  const { registry, vehicle, crew } = fixture();
  assert.equal(vehicle.seats.length, 4); assert.equal(vehicle.health, CHI_HA.health);
  assert.deepEqual(vehicle.seats.map(seat => seat.role), ['commander', 'gunner', 'driver', 'hull-gunner']);
  assert.ok(crew.every(actor => actor.targetKind === 'closed-armor'));
  assert.equal(vehicle.weapon.ownerId, vehicle.id);
  for (const weapon of ['rifle', 'grenade']) {
    damageVehicleEntity(registry, vehicle, damageForTarget(weapon, 'closed-armor', 100));
    assert.equal(vehicle.health, CHI_HA.health);
  }
  assert.equal(damageVehicleEntity(registry, vehicle, 95).casualties.length, 1);
  assert.equal(damageVehicleEntity(registry, vehicle, vehicle.health).casualties.length, 3);
  assert.ok(crew.every(actor => actor.health === 0));
  assert.equal(vehicleCollider(vehicle).hz, 2.75);
});
test('each tank squad replenishes after a wipe without reducing or adding formation slots', () => {
  const roster = battleRoster(), tanks = roster.filter(unit => unit.variant === CHI_HA.id);
  for (const tank of tanks) tank.members = Array.from({ length: 4 }, () => ({ health: 100 }));
  assert.equal(reinforcementDue(tanks[0], 10), false, 'a surviving tank squad never receives a duplicate hull');
  tanks[0].members.forEach(actor => { actor.health = 0; });
  assert.equal(reinforcementDue(tanks[0], 10), true, 'armor does not wait through the infantry seventeen-second cooldown');
  tanks[0].respawnAt = 12;
  assert.equal(reinforcementDue(tanks[0], 11), false, 'blocked garages retry explicitly instead of spawning through a wreck');
  assert.equal(reinforcementDue(tanks[0], 12), true);
  tanks[0].members = Array.from({ length: 4 }, () => ({ health: 100 }));
  tanks[0].respawnAt = null;
  assert.equal(reinforcementDue(tanks[0], 12), false);
  validateRoster(roster);
  assert.equal(roster.length, 20); assert.equal(tanks.length, 1);
});
test('original near model has six road wheels per side, shared geometry and a bounded draw budget', () => {
  const a = chiHaModel(), b = chiHaModel();
  assert.equal(a.children[0].geometry, b.children[0].geometry);
  assert.equal(a.children[0].material, b.children[0].material);
  assert.equal(a.userData.centers.filter(([, , , scale]) => scale === 1).length, 12);
  assert.equal(a.userData.links.count, 184);
  a.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3());
  assert.ok(size.x > 2.3 && size.x < 2.4);
  assert.ok(size.y > 2 && size.y < 2.25);
  assert.ok(size.z > 5.5 && size.z < 5.65);
  let draws = 0, triangles = 0;
  a.traverse(mesh => { if (mesh.isMesh) {
    draws++; triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.count ?? 1);
  } });
  assert.ok(draws <= 20); assert.ok(triangles < 45000);
  const before = a.userData.links.instanceMatrix.array.slice();
  animateChiHa(a, 2, .15, false);
  assert.notDeepEqual(a.userData.links.instanceMatrix.array, before);
  assert.deepEqual(b.userData.links.instanceMatrix.array, before, 'animation never changes another tank');
  const material = b.children[0].material;
  animateChiHa(a, 2, .15, true);
  assert.notEqual(a.children[0].material, material); assert.equal(b.children[0].material, material);
});
test('barrel tip and collision rays follow the same owned turret yaw and elevation', () => {
  const { vehicle } = fixture(), scene = new THREE.Scene(), renderer = createVehicleRenderer(scene);
  for (const heading of [0, .6, Math.PI]) {
    vehicle.heading = heading; vehicle.turretYaw = heading + .4; vehicle.turretPitch = .13;
    vehicle.position.set(12, 1.4, -23);
    renderer.update([vehicle]);
    const model = renderer.model(vehicle.id);
    const tip = new THREE.Vector3(0, 0, -CHI_HA.gun.length).applyMatrix4(model.userData.gun.matrixWorld);
    const muzzle = chiHaMuzzle(vehicle);
    assert.ok(tip.distanceTo(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z)) < 1e-8);
  }
  vehicle.position.set(0, 0, 0); vehicle.heading = vehicle.turretYaw = vehicle.turretPitch = 0;
  renderer.update([vehicle]);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, .8, -8), new THREE.Vector3(0, 0, 1), 0, 12);
  assert.equal(ray.intersectObject(renderer.model(vehicle.id), true)[0]?.object.userData.vehicleId, vehicle.id);
  renderer.clear(); assert.equal(scene.children.length, 0);
});
test('both machine-gun rays follow their own rendered muzzle, including the rear-facing turret mount', () => {
  const { vehicle } = fixture(), scene = new THREE.Scene(), renderer = createVehicleRenderer(scene);
  for (const heading of [0, .6, Math.PI]) {
    vehicle.heading = heading; vehicle.turretYaw = heading + .7; vehicle.turretPitch = .13;
    vehicle.position.set(12, 1.4, -23);
    vehicle.machineGuns.forEach((gun, index) => { gun.yaw = index ? -.3 : .2; gun.pitch = index ? -.1 : .15; });
    renderer.update([vehicle]);
    vehicle.machineGuns.forEach((gun, index) => {
      const tip = new THREE.Vector3(0, 0, -CHI_HA_MG_MOUNTS[index].length)
        .applyMatrix4(renderer.model(vehicle.id).userData.machineGuns[index].matrixWorld);
      const { start } = chiHaMachineGunPose(vehicle, gun);
      assert.ok(tip.distanceTo(new THREE.Vector3(start.x, start.y, start.z)) < 1e-8);
    });
  }
  renderer.clear();
});
test('AI turns and aims before firing, uses original gun ownership and model-specific reload time', () => {
  const { registry, vehicle, crew } = fixture(), ctx = context(crew);
  vehicle.turretYaw = Math.PI;
  let shot, firedAt;
  for (let i = 0; i < 80; i++) {
    advanceOwnedWeapons(registry, .1, i / 10);
    const result = advanceChiHaAI(vehicle, .1, i / 10, ctx);
    if (i < 50) assert.equal(result, null, 'cannot fire before turning through a rear target');
    if (result) { shot = result; firedAt = i / 10; break; }
  }
  assert.ok(shot); assert.equal(shot.targetId, target.id);
  assert.equal(vehicle.ai.shots, 1); assert.equal(vehicle.weapon.ammo, 0);
  const before = JSON.stringify(vehicle);
  advanceChiHaAI(vehicle, 0, 8, ctx);
  assert.equal(JSON.stringify(vehicle), before, 'paused AI leaves all owned state untouched');
  advanceChiHaAI(vehicle, .1, 8, ctx);
  assert.equal(vehicle.weapon.reloadUntil, firedAt + CHI_HA.reload);
  advanceOwnedWeapons(registry, .1, firedAt + CHI_HA.reload - .01);
  assert.equal(vehicle.weapon.ammo, 0);
  advanceOwnedWeapons(registry, .1, firedAt + CHI_HA.reload);
  assert.equal(vehicle.weapon.ammo, 1);
});
test('walls, blocked fire lanes, friendly blast risk, dead crew and missing gunners prevent fire', () => {
  for (const extra of [{ visible: () => false }, { safeToFire: () => false }, { crew: [] }, { canFire: false }]) {
    const { vehicle, crew } = fixture();
    for (let i = 0; i < 30; i++) assert.equal(advanceChiHaAI(vehicle, .1, i / 10, context(crew, extra)), null);
    assert.equal(vehicle.weapon.ammo, 1);
  }
});
test('tank uses its own clearance, advances only along a reachable path and does not shoot through walls', () => {
  const { vehicle, crew } = fixture();
  const obstacles = [{ minX: -10, maxX: 10, minZ: -8, maxZ: -7 }];
  const ctx = context(crew, { visible: () => false, move: (p, dx, dz) => moveGround(p, dx, dz, CHI_HA.clearance, obstacles) });
  for (let i = 0; i < 80; i++) advanceChiHaAI(vehicle, .1, i / 10, ctx);
  assert.ok(vehicle.trackDistance > 0);
  assert.ok(vehicle.position.z >= -4.01);
  assert.equal(circleBlocked(vehicle.position.x, vehicle.position.z, CHI_HA.clearance, obstacles), false);
  assert.equal(vehicle.ai.shots, 0);
  const stopped = { ...vehicle.position };
  ctx.pathTo = () => [];
  advanceChiHaAI(vehicle, .1, 20, ctx);
  assert.deepEqual({ ...vehicle.position }, stopped);
  assert.equal(vehicle.ai.mode, 'blocked');
});

test('a distant visible target does not park a tank at its maximum detection range', () => {
  const { vehicle, crew } = fixture();
  for (let i = 0; i < 50; i++) advanceChiHaAI(vehicle, .1, i / 10, context(crew));
  assert.ok(vehicle.trackDistance >= 15);
  assert.ok(vehicle.position.z < -15);
  assert.equal(vehicle.ai.mode, 'advance');
  assert.deepEqual(vehicle.ai.goal, { x: 0, z: -80 });
});

test('a visible nearby enemy cannot replace the objective or keep a tank parked thirty metres away', () => {
  for (const extra of [{}, { safeToFire: () => false }, { canFire: false }]) {
    const { registry, vehicle, crew } = fixture(), planned = [];
    const objective = { id: 'A', x: 0, z: -80 };
    const ctx = context(crew, { objective, targets: [{ ...target, position: { x: 20, y: 0, z: -10 } }],
      pathTo: (from, to) => { planned.push({ ...to }); return [to]; }, ...extra });
    for (let i = 0; i < 300; i++) {
      advanceOwnedWeapons(registry, .1, i / 10);
      advanceChiHaAI(vehicle, .1, i / 10, ctx);
    }
    assert.ok(vehicle.position.z < -74, 'the hull reaches the actual objective even while observing enemies');
    assert.ok(vehicle.ai.distanceToObjective <= CHI_HA.arrivalDistance);
    assert.equal(vehicle.ai.objectiveId, 'A');
    assert.ok(planned.every(goal => goal.x === objective.x && goal.z === objective.z));
    assert.ok(planned.length <= 11, 'target tracking does not constantly discard the objective route');
  }
});

test('cannon firing pauses are bounded and the tank continues advancing while reloading', () => {
  const { registry, vehicle, crew } = fixture();
  const ctx = context(crew, { objective: { id: 'A', x: 0, z: -80 } });
  assert.ok(advanceChiHaAI(vehicle, .1, 0, ctx), 'an aligned loaded gun takes its brief firing stop');
  assert.equal(vehicle.weapon.ammo, 0);
  const before = vehicle.position.z;
  for (let i = 1; i < 40; i++) {
    const now = i / 10;
    advanceOwnedWeapons(registry, .1, now);
    assert.equal(advanceChiHaAI(vehicle, .1, now, ctx), null);
    assert.notEqual(vehicle.ai.mode, 'aim', 'loading must not hold the hull stationary');
  }
  assert.ok(vehicle.position.z < before - 15);
  assert.ok(vehicle.weapon.reloadUntil > 3.9);
  const frozen = JSON.stringify(vehicle);
  advanceChiHaAI(vehicle, 0, 100, ctx);
  assert.equal(JSON.stringify(vehicle), frozen, 'pause does not expire its aim or reload clocks');
});

test('capturing an objective switches the hull route immediately, independently of its retained enemy target', () => {
  const { vehicle, crew } = fixture(), planned = [];
  const ctx = context(crew, { canFire: false, objective: { id: 'A', x: 0, z: -80 },
    pathTo: (from, to) => { planned.push(to.id); return [to]; } });
  advanceChiHaAI(vehicle, .1, 0, ctx);
  assert.equal(vehicle.ai.targetId, target.id);
  ctx.objective = { id: 'B', x: 40, z: -20 };
  advanceChiHaAI(vehicle, .1, .1, ctx);
  assert.deepEqual(planned, ['A', 'B']);
  assert.equal(vehicle.ai.objectiveId, 'B');
  assert.deepEqual(vehicle.ai.goal, { x: 40, z: -20 });
  assert.equal(vehicle.ai.targetId, target.id);
});

test('tank squads receive separate objective stations rather than parking together across the bridge', () => {
  const objective = { id: 'B', x: 8, z: -7, radius: 13 };
  const [a, b] = [0, 1].map(slot => chiHaObjectiveDestination(slot, objective));
  assert.equal(a.id, 'B'); assert.equal(b.id, 'B');
  assert.ok(b.x - a.x > CHI_HA.clearance * 2);
  assert.ok(b.x - a.x - CHI_HA.arrivalDistance * 2 > CHI_HA.clearance * 2 + .1,
    'arrival tolerances cannot let a parked tank consume the other station turning envelope');
  assert.equal(a.z, objective.z); assert.equal(b.z, objective.z);
  assert.deepEqual(objective, { id: 'B', x: 8, z: -7, radius: 13 });
  assert.equal(chiHaObjectiveDestination(0, null), null);
  assert.throws(() => chiHaObjectiveDestination(2, objective), /formation slots/);
});

test('two converging tanks retain turning clearance and both pass a single-lane approach', () => {
  const obstacles = [
    { minX: -45, maxX: -4.5, minZ: -20, maxZ: 25 },
    { minX: 4.5, maxX: 45, minZ: -20, maxZ: 25 },
  ];
  const navigation = createTankNavigation(obstacles);
  const fixtures = [fixture(), fixture()], vehicles = fixtures.map(({ vehicle }, index) => {
    vehicle.id = `convoy-${index}`;
    vehicle.position.set(index ? 8 : -8, 0, -45);
    vehicle.heading = vehicle.turretYaw = Math.PI;
    return vehicle;
  });
  for (let i = 0; i < 1500; i++) {
    fixtures.forEach(({ vehicle, crew }) => advanceChiHaAI(vehicle, .1, i / 10, context(crew, {
      targets: [], objective: { x: 0, z: 50 }, visible: () => false,
      pathTo: (from, to) => navigation.pathTo(vehicle, to, vehicles),
      canTravel: (from, to) => navigation.canTravel(vehicle, from, to, vehicles),
      move: (p, dx, dz) => navigation.move(vehicle, dx, dz, vehicles),
    })));
    assert.ok(vehicles[0].position.distanceTo(vehicles[1].position) >= 5.98, 'hull rotation cannot consume a neighbouring turning envelope');
    for (const vehicle of vehicles) assert.equal(circleBlocked(vehicle.position.x, vehicle.position.z, CHI_HA.clearance, obstacles), false);
  }
  for (const vehicle of vehicles) {
    assert.ok(vehicle.position.z > 30, `${vehicle.id} must not remain beside its partner: ${JSON.stringify(vehicle.position)}`);
    assert.ok(vehicle.trackDistance > 80);
  }
  navigation.reset();
});

test('traffic planning includes wrecks, newly moved vehicles and spawn turning clearance', () => {
  const navigation = createTankNavigation([]), { vehicle } = fixture(), other = fixture().vehicle;
  other.id = 'other'; other.position.set(0, 0, -15); other.health = 0;
  const vehicles = [vehicle, other], goal = { x: 0, z: -35 };
  assert.equal(navigation.canTravel(vehicle, vehicle.position, goal, vehicles), false);
  const path = navigation.pathTo(vehicle, goal, vehicles);
  assert.ok(path.length > 1);
  other.position.set(20, 0, 20);
  assert.deepEqual(navigation.pathTo(vehicle, goal, vehicles), [goal]);
  assert.equal(navigation.canTravel(vehicle, vehicle.position, goal, vehicles), true);
  assert.equal(navigation.canSpawn({ x: 25, z: 20 }, [other]), false);
  assert.equal(navigation.canSpawn({ x: 28, z: 20 }, [other]), true);
  assert.ok(segmentClear(vehicle.position, goal, CHI_HA.clearance, []));
});

function machineGunContext(crew, extra = {}) {
  return { crew, targets: [{ ...target, position: { x: -.51, y: 0, z: -20 } }],
    busyCrewIds: [], aimPoint: actor => ({ ...actor.position, y: actor.position.y + 1 }),
    visible: () => true, safeToFire: () => true, ...extra };
}

test('a stationed tank faces visible enemies so its hull machine gun is not stranded facing the approach route', () => {
  const { registry, vehicle, crew } = fixture(), guns = machineGunContext(crew);
  vehicle.heading = Math.PI / 2;
  const ctx = context(crew, { objective: { id: 'C', x: 0, z: 0 }, canFire: false, targets: guns.targets });
  advanceChiHaAI(vehicle, .1, 0, { ...ctx, visible: () => false });
  assert.equal(vehicle.heading, Math.PI / 2, 'holding a station alone does not invent an enemy bearing');
  for (let i = 1; i <= 80; i++) {
    const now = i / 10;
    advanceOwnedWeapons(registry, .1, now);
    advanceChiHaAI(vehicle, .1, now, ctx);
    advanceChiHaMachineGuns(vehicle, .1, now, guns);
  }
  assert.deepEqual({ ...vehicle.position }, { x: 0, y: 0, z: 0 });
  assert.equal(vehicle.ai.mode, 'engage');
  assert.ok(vehicle.machineGuns[0].shots >= CHI_HA_MG.burst);
});

test('owned tank machine guns fire five-round bursts, cool down, empty twenty-round magazines and reload independently', () => {
  const { registry, vehicle, crew } = fixture(), gun = vehicle.machineGuns[0], log = [];
  let reloading = false;
  for (let i = 0; i < 1000; i++) {
    const now = i / 50;
    advanceOwnedWeapons(registry, .02, now);
    const shots = advanceChiHaMachineGuns(vehicle, .02, now, machineGunContext(crew));
    for (const shot of shots) {
      assert.equal(shot.gun, gun);
      assert.equal(shot.operator.id, crew[3].id);
      assert.equal(registry.weapons.get(gun.id), gun);
      assert.equal(gun.ownerId, vehicle.id);
      log.push(now);
    }
    if (gun.reloadUntil > now) {
      reloading = true;
      assert.equal(shots.length, 0);
      assert.equal(gun.ammo, 0);
    }
  }
  assert.ok(log.length > 20, 'firing resumes after magazine replacement');
  for (let i = 1; i < log.length; i++) {
    const gap = log[i] - log[i - 1];
    assert.ok(gap >= (i % 5 === 0 ? CHI_HA_MG.cooldown : CHI_HA_MG.interval) - 1e-8);
    if (i % 20 === 0) assert.ok(gap >= CHI_HA_MG.reload);
  }
  assert.equal(reloading, true);
  assert.equal(vehicle.machineGuns[1].shots, 0, 'rear gun is not a fictional forward-firing coaxial gun');
  assert.equal(vehicle.weapon.ammo, 1, 'main gun has its own ammunition and reload clock');
});

test('machine guns respect crew, actual firing arcs, line of sight, friendly cover and pause', () => {
  for (const extra of [
    { crew: [] }, { visible: () => false }, { safeToFire: () => false },
    { busyCrewIds: ['crew-3'] },
    { targets: [{ ...target, targetKind: 'closed-armor', vehicleId: 'target-tank' }] },
    { targets: [{ ...target, targetKind: 'aircraft' }] },
    { targets: [{ ...target, position: { x: 30, y: 0, z: 0 } }] },
    { targets: [{ ...target, position: { x: 0, y: 0, z: -70 } }] },
  ]) {
    const { vehicle, crew } = fixture();
    for (let i = 0; i < 50; i++) {
      assert.equal(advanceChiHaMachineGuns(vehicle, .1, i / 10, machineGunContext(crew, extra)).length, 0);
    }
    assert.ok(vehicle.machineGuns.every(gun => gun.ammo === 20));
  }
  const { vehicle, crew, registry } = fixture();
  const rear = { ...target, position: { x: .42, y: 0, z: 20 } };
  const shots = advanceChiHaMachineGuns(vehicle, .1, 0, machineGunContext(crew, { targets: [rear] }));
  assert.equal(shots.length, 1);
  assert.equal(shots[0].gun.mount, 'rear');
  assert.equal(shots[0].operator, crew[0]);
  vehicle.machineGuns[0].ammo = 0; vehicle.machineGuns[0].reloadUntil = 2;
  const before = JSON.stringify(vehicle);
  advanceOwnedWeapons(registry, 0, 20);
  advanceChiHaMachineGuns(vehicle, 0, 20, machineGunContext(crew));
  assert.equal(JSON.stringify(vehicle), before);
  vehicle.health = 0;
  assert.equal(advanceChiHaMachineGuns(vehicle, .1, 21, machineGunContext(crew)).length, 0);
});
