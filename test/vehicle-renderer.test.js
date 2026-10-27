import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEntityRegistry, registerUnit, registerSoldier, createVehicleEntity, seatSoldier, releaseSeat, damageVehicleEntity } from '../src/entities.js';
import { createVehicleRenderer } from '../src/vehicle-renderer.js';
import { canRiflemanTrackTarget, damageForTarget } from '../src/combat-targets.js';

function fixture() {
  const registry = createEntityRegistry(), scene = new THREE.Scene();
  registerUnit(registry, { id: 'ground', team: 'friendly', type: 'tank' });
  registerUnit(registry, { id: 'air', team: 'friendly', type: 'plane' });
  const tank = createVehicleEntity(registry, { id: 'tank-1', unitId: 'ground', team: 'friendly', type: 'tank', position: new THREE.Vector3(0, .45, 5) });
  const plane = createVehicleEntity(registry, { id: 'plane-1', unitId: 'air', team: 'friendly', type: 'plane', position: new THREE.Vector3(30, 20, -10) });
  return { registry, scene, tank, plane, renderer: createVehicleRenderer(scene) };
}
test('vehicle views project independent hull/turret/flight pose without modifying simulation or owning its records', () => {
  const { registry, scene, tank, plane, renderer } = fixture();
  tank.heading = .4; tank.turretYaw = 1.1;
  plane.heading = -.6; plane.pitch = .2; plane.roll = -.15;
  const before = JSON.stringify([...registry.vehicles.values()]);
  renderer.update(registry.vehicles.values());
  assert.equal(JSON.stringify([...registry.vehicles.values()]), before);
  assert.equal('model' in tank, false); assert.equal('model' in plane, false);
  const hull = renderer.model(tank.id), aircraft = renderer.model(plane.id);
  assert.deepEqual(hull.position, tank.position);
  assert.equal(hull.rotation.y, .4);
  assert.ok(Math.abs(hull.userData.turret.rotation.y - .7) < 1e-10);
  assert.equal(aircraft.rotation.x, plane.pitch); assert.equal(aircraft.rotation.y, plane.heading); assert.equal(aircraft.rotation.z, plane.roll);
  renderer.update(registry.vehicles.values());
  assert.equal(renderer.model(tank.id), hull);
  assert.equal(scene.children.length, 2);
  renderer.clear();
});
test('actual vehicle ray targets are synchronised to owned position and bind by stable ID', () => {
  const { registry, tank, renderer } = fixture();
  renderer.update(registry.vehicles.values());
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 0, 15);
  const hit = ray.intersectObject(renderer.model(tank.id), true)[0];
  assert.ok(hit);
  assert.equal(hit.object.userData.vehicleId, tank.id);
  tank.position.x = 15;
  renderer.update(registry.vehicles.values());
  assert.equal(ray.intersectObject(renderer.model(tank.id), true).length, 0);
  renderer.clear();
});
test('wreck views remain until registry retirement and cleanup never disposes shared assets', () => {
  const { registry, scene, tank, plane, renderer } = fixture();
  renderer.update(registry.vehicles.values());
  const model = renderer.model(tank.id), resources = new Set();
  model.traverse(object => { if (object.isMesh) { resources.add(object.geometry); resources.add(object.material); } });
  let disposed = 0;
  const listener = () => disposed++;
  for (const resource of resources) resource.addEventListener('dispose', listener);
  tank.health = 0;
  renderer.update(registry.vehicles.values());
  assert.equal(renderer.model(tank.id), model);
  assert.equal(model.parent, scene);
  registry.vehicles.delete(tank.id);
  renderer.update(registry.vehicles.values());
  assert.equal(model.parent, null);
  assert.deepEqual(renderer.snapshot, { count: 1, ids: [plane.id] });
  assert.throws(() => renderer.model(tank.id), /no registered view/);
  renderer.clear();
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, 0);
  for (const resource of resources) resource.removeEventListener('dispose', listener);
});
test('an actual aircraft hull contact rejects rifle damage and its seated pilot shares aircraft classification', () => {
  const { registry, plane, renderer } = fixture();
  const pilot = registerSoldier(registry, { id: 'pilot-1', unitId: 'air', team: 'friendly', health: 100,
    groundType: 'infantry', position: new THREE.Vector3(), rifle: {} });
  assert.equal(seatSoldier(registry, pilot, plane, plane.seats[0].id), null);
  renderer.update(registry.vehicles.values());
  const ray = new THREE.Raycaster(plane.position.clone().add(new THREE.Vector3(0, 0, 15)), new THREE.Vector3(0, 0, -1), 0, 30);
  const hit = ray.intersectObject(renderer.model(plane.id), true)[0];
  assert.ok(hit, 'the real aircraft mesh is a physical hit, not an empty sky miss');
  assert.equal(hit.object.userData.vehicleId, plane.id);
  const health = plane.health;
  assert.equal(pilot.targetKind, 'aircraft');
  assert.equal(canRiflemanTrackTarget(pilot.targetKind), false);
  for (const targetKind of ['aircraft', pilot.targetKind]) {
    const result = damageVehicleEntity(registry, plane, damageForTarget('rifle', targetKind, 100));
    assert.equal(result.damage, 0);
    assert.equal(plane.health, health);
    assert.equal(pilot.health, 100);
  }
  releaseSeat(registry, pilot);
  assert.equal(pilot.targetKind, 'person');
  assert.equal(canRiflemanTrackTarget(pilot.targetKind), true);
  assert.equal(damageForTarget('rifle', pilot.targetKind, 50, 'torso'), 50);
  assert.equal(seatSoldier(registry, pilot, plane, plane.seats[0].id), null);
  const collision = damageVehicleEntity(registry, plane, damageForTarget('collision', 'aircraft', plane.health));
  assert.equal(collision.destroyed, true);
  assert.equal(pilot.health, 0, 'rifle rejection does not turn the plane or its pilot globally invulnerable');
  renderer.clear();
});
test('invalid vehicle identities and poses fail before becoming silent missing geometry', () => {
  const { registry, tank, renderer } = fixture();
  assert.throws(() => createVehicleEntity(registry, { unitId: 'ground', type: 'tank', position: { x: 0, y: 0, z: 0 } }), /Invalid vehicle/);
  assert.throws(() => createVehicleEntity(registry, { id: 'bad', unitId: 'ground', type: 'tank', position: { x: NaN, y: 0, z: 0 } }), /Invalid vehicle/);
  assert.throws(() => renderer.update([tank, tank]), /Duplicate/);
  tank.roll = NaN;
  assert.throws(() => renderer.update(registry.vehicles.values()), /finite pose/);
});
