import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TANK_FIRE, tankFirePose, selectTankFires, createTankFireEffects } from '../src/tank-fire.js';

const wreck = (overrides = {}) => ({ id: 'wreck-1', type: 'tank', health: 0, destroyedAt: 0,
  position: { x: 0, y: 0, z: 0 }, heading: 0, turretYaw: 0, variant: null, ...overrides });
const settings = { preset: 'high', effects: { hitParticles: true } };
function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const fire = createTankFireEffects(scene, camera, new THREE.Texture());
  fire.configure(settings);
  return { scene, camera, fire };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('both model-specific sources follow hull and turret coordinates, not the camera or world forward', () => {
  const vickers = tankFirePose(wreck(), 1);
  assert.deepEqual(vickers.engine, { x: 0, y: 1.28, z: 1.45 });
  near(vickers.hatch.x, -.3); near(vickers.hatch.y, 2.15); near(vickers.hatch.z, -.31);
  const vehicle = wreck({ variant: 'chi-ha', heading: Math.PI / 2, turretYaw: Math.PI,
    position: { x: 10, y: .45, z: -5 } });
  const before = JSON.stringify(vehicle), chiHa = tankFirePose(vehicle, 1);
  near(chiHa.engine.x, 11.65); near(chiHa.engine.y, 1.75); near(chiHa.engine.z, -5);
  near(chiHa.hatch.x, 9.41); near(chiHa.hatch.y, 2.6); near(chiHa.hatch.z, -5.24);
  assert.equal(JSON.stringify(vehicle), before);
});

test('strong jet becomes lower residual fire, then smoke only, and never restarts after culling', () => {
  const vehicle = wreck({ destroyedAt: 10 });
  assert.equal(tankFirePose(vehicle, 9), null);
  assert.ok(tankFirePose(vehicle, 10.3).height > 3.8);
  assert.ok(tankFirePose(vehicle, 16).height < 1.6);
  assert.ok(tankFirePose(vehicle, 26).intensity > 0);
  assert.equal(tankFirePose(vehicle, 28).intensity, 0);
  assert.equal(tankFirePose(vehicle, 28).height, 0);
  assert.equal(tankFirePose(vehicle, 32), null);
  assert.equal(tankFirePose(wreck({ health: 100 }), 1), null);
  assert.equal(tankFirePose(wreck(), 4).hatchIntensity, 0);
});

test('only the nearest four confirmed tank wrecks are selected with stable ordering and finite range', () => {
  const observer = { x: 0, y: 0, z: 0 };
  const vehicles = Array.from({ length: 40 }, (_, i) => wreck({ id: `wreck-${i}`, position: { x: i * 5, y: 0, z: 0 } }));
  vehicles.push(wreck({ id: 'alive', health: 100 }), wreck({ id: 'plane', type: 'plane' }),
    wreck({ id: 'missing-time', destroyedAt: undefined }));
  const selected = selectTankFires(vehicles, 2, observer);
  assert.deepEqual(selected.map(item => item.id), ['wreck-0', 'wreck-1', 'wreck-2', 'wreck-3']);
  assert.equal(selectTankFires(vehicles, 2, { x: 1000, y: 0, z: 0 }).length, 0);
  assert.equal(selectTankFires(vehicles, 22, observer).length, 0);
  assert.throws(() => selectTankFires([wreck(), wreck()], 1, observer), /Duplicate/);
});

test('pooled fire and smoke survive gunfire budgets, freeze on repeated time and retire with their wrecks', () => {
  const { scene, fire } = fixture(), vehicles = [wreck()];
  const before = JSON.stringify(vehicles), objects = [...scene.children];
  fire.update(vehicles, 1);
  const snapshot = fire.snapshot;
  assert.equal(snapshot.wrecks, 1); assert.equal(snapshot.flamePlanes, 6);
  assert.ok(snapshot.smoke > 0);
  fire.update(vehicles, 1);
  assert.deepEqual(fire.snapshot, snapshot, 'no wall-clock driven changes while paused');
  fire.update(vehicles, 8);
  assert.equal(fire.snapshot.flamePlanes, 3);
  assert.equal(fire.snapshot.smoke, TANK_FIRE.smokePerWreck);
  fire.update(vehicles, 19);
  assert.equal(fire.snapshot.flamePlanes, 0); assert.ok(fire.snapshot.smoke > 0);
  fire.update([], 19);
  assert.equal(fire.snapshot.wrecks + fire.snapshot.flamePlanes + fire.snapshot.smoke, 0);
  assert.ok(scene.children.every(group => !group.visible), 'removing a wreck leaves no orphan flame or smoke');
  assert.deepEqual(scene.children, objects, 'no render objects are allocated or retired during updates');
  assert.equal(JSON.stringify(vehicles), before, 'the effect never changes health, pose or ownership');
});

test('quality switches and independent disable apply immediately while paused without restarting the burn', () => {
  const { fire } = fixture();
  const vehicles = Array.from({ length: 20 }, (_, i) => wreck({ id: `wreck-${i}`, position: { x: i * 2, y: 0, z: 0 } }));
  fire.update(vehicles, 1);
  assert.equal(fire.snapshot.wrecks, 4);
  assert.equal(fire.snapshot.flamePlanes, 24);
  fire.configure({ ...settings, preset: 'low' });
  assert.equal(fire.snapshot.wrecks, 2);
  assert.equal(fire.snapshot.flamePlanes, 8);
  assert.ok(fire.snapshot.smoke <= 8);
  fire.configure({ ...settings, effects: { hitParticles: false } });
  assert.equal(fire.snapshot.wrecks + fire.snapshot.flamePlanes + fire.snapshot.smoke, 0);
  fire.configure(settings);
  assert.equal(fire.snapshot.sources[0].age, 1);
  fire.clear(); fire.configure(settings);
  assert.equal(fire.snapshot.wrecks, 0);
});

test('sampled presentation is identical at 30, 60 and 144Hz and returning to range retains the real burn age', () => {
  const snapshots = [];
  for (const hz of [30, 60, 144]) {
    const { fire, camera } = fixture();
    for (let frame = 0; frame <= hz * 5; frame++) fire.update([wreck()], frame / hz);
    snapshots.push(fire.snapshot);
    camera.position.x = 1000; fire.update([wreck()], 6);
    assert.equal(fire.snapshot.wrecks, 0);
    camera.position.x = 0; fire.update([wreck()], 7);
    assert.equal(fire.snapshot.sources[0].age, 7);
    assert.ok(fire.snapshot.sources[0].height < 1.6);
  }
  assert.deepEqual(snapshots[0], snapshots[1]); assert.deepEqual(snapshots[1], snapshots[2]);
});

test('invalid wreck poses and times fail explicitly before reaching the renderer', () => {
  for (const value of [wreck({ variant: 'unknown' }), wreck({ destroyedAt: NaN }), wreck({ heading: Infinity }),
    wreck({ position: { x: 0, y: NaN, z: 0 } }), wreck({ turretYaw: NaN })]) {
    assert.throws(() => tankFirePose(value, 1), RangeError);
  }
  assert.throws(() => tankFirePose(wreck(), -1), RangeError);
  assert.throws(() => selectTankFires([], 0, { x: 0, y: NaN, z: 0 }), RangeError);
});

test('offscreen wrecks do not occupy visible fire slots and turning restores the current burn phase', () => {
  const { fire, camera } = fixture();
  const vehicles = [
    ...Array.from({ length: 4 }, (_, i) => wreck({ id: `behind-${i}`, position: { x: i, y: 0, z: 20 } })),
    ...Array.from({ length: 4 }, (_, i) => wreck({ id: `ahead-${i}`, position: { x: i, y: 0, z: -35 } })),
  ];
  const before = JSON.stringify(vehicles);
  fire.update(vehicles, 1);
  assert.deepEqual(fire.snapshot.ids, vehicles.slice(4).map(vehicle => vehicle.id));
  camera.rotation.y = Math.PI;
  fire.update(vehicles, 8);
  assert.deepEqual(fire.snapshot.ids, vehicles.slice(0, 4).map(vehicle => vehicle.id));
  assert.ok(fire.snapshot.sources.every(source => source.age === 8 && source.height < 1.6));
  camera.rotation.y = 0;
  fire.update(vehicles, 19);
  assert.equal(fire.snapshot.flamePlanes, 0);
  assert.ok(fire.snapshot.smoke > 0, 'return to smoke-only phase, not a new fireball');
  fire.update(vehicles, 22);
  assert.equal(fire.snapshot.wrecks, 0);
  assert.equal(JSON.stringify(vehicles), before);
});
