import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSihangFlag } from '../src/sihang-flag.js';
import { sihangRiverBounds, sihangRiverRayRange, sihangNorthBank, sihangSouthBank,
  SIHANG_WAREHOUSE, SIHANG_BRIDGE, sihangBridgePoint } from '../src/sihang-layout.js';
import { sihangEnemyTargetAllowed, sihangEnemyRayRange, SIHANG_EMPLACEMENTS } from '../src/sihang-roster.js';
import { sihangSafePosition, sihangEnemyMayAttack } from '../src/sihang-campaign.js';
import { EMPLACEMENT_PROFILES } from '../src/emplacements.js';
import { SIHANG_PREVIEW } from '../src/sihang-preview.js';

test('the reference bay rises on both sides, has an eastern diagonal bridge, and shares banks with combat and safe areas', () => {
  assert.ok(Math.abs(sihangRiverBounds(48).northZ + 94 / 81) < 1e-8);
  for (const x of [-36, -20, 0, 20, 28]) assert.equal(sihangRiverBounds(x).northZ, 0);
  for (const x of [-10000, -108, -80, 0, 52, 108, 10000]) {
    const banks = sihangRiverBounds(x);
    assert.equal(banks.southZ - banks.northZ, 32);
    assert.ok(banks.northZ >= -88 && banks.northZ <= 20);
  }
  for (const x of [-36, 28]) assert.ok(Math.abs(sihangRiverBounds(x + .001).northZ - sihangRiverBounds(x - .001).northZ) < 1e-7);
  assert.ok(SIHANG_BRIDGE.southX > SIHANG_BRIDGE.northX);
  assert.ok(sihangNorthBank(sihangBridgePoint(0)));
  assert.ok(sihangSouthBank(sihangBridgePoint(1)));
  const west = sihangRiverBounds(-100);
  const safeWest = { x: -100, y: 0, z: west.southZ + 4 }, waterWest = { x: -100, y: -1, z: (west.northZ + west.southZ) / 2 };
  assert.equal(sihangSafePosition(safeWest), true);
  assert.equal(sihangSafePosition(waterWest), false);
  assert.equal(sihangEnemyMayAttack(safeWest), false);
  assert.equal(sihangEnemyTargetAllowed({ position: safeWest }), false);
  assert.equal(sihangSouthBank(safeWest, 4), true);
  assert.equal(sihangNorthBank({ x: -100, z: west.northZ - 1 }), true);
  const south = sihangRiverBounds(48).southZ;
  assert.equal(sihangSouthBank({ x: 48, z: south - .01 }), false);
  assert.equal(sihangSafePosition({ x: 48, y: 0, z: south + 3.99 }), false);
  assert.equal(sihangSafePosition({ x: 48, y: 0, z: south + 4 }), true);
  for (const invalid of [null, {}, { x: NaN, z: 40, y: 0 }, { x: 0, z: Infinity, y: 0 }]) {
    assert.equal(sihangSafePosition(invalid), false);
    assert.equal(sihangEnemyMayAttack(invalid), false);
    assert.equal(sihangNorthBank(invalid), false);
    assert.equal(sihangSouthBank(invalid), false);
  }
  assert.throws(() => sihangRiverBounds(Infinity), RangeError);
});

test('analytic bank clipping catches oblique and lateral shots without range-dependent sampling', () => {
  assert.ok(Math.abs(sihangEnemyRayRange({ x: 48, z: 8 }, { x: 0, z: 1 }, 220) -
    (sihangRiverBounds(48).southZ - 8)) < 1e-8);
  assert.equal(sihangEnemyRayRange({ x: 48, z: 34 }, { x: 0, z: -1 }, 220), 0);
  const origin = { x: 48, z: 25 }, direction = { x: -1, z: 0 };
  const range = sihangRiverRayRange(origin, direction, 300);
  assert.ok(range > 4 && range < 156, 'A lateral ray hits the curved west concession bank');
  assert.ok(Math.abs(origin.z - sihangRiverBounds(origin.x - range).southZ) < 1e-7);
  assert.ok(Math.abs(sihangRiverRayRange({ x: 48, z: 20 }, { x: 0, z: 1 }, 40, 3) -
    (sihangRiverBounds(48).southZ - 23)) < 1e-8);
  // A fixed independent dense oracle checks many headings, including rays leaving and re-entering bank segments.
  for (let i = 0; i < 80; i++) {
    const origin = { x: -105 + i * 2.6, z: 3 + i % 5 * 3 };
    const angle = i * 2.399, direction = { x: Math.cos(angle), z: Math.sin(angle) };
    const clipped = sihangRiverRayRange(origin, direction, 240);
    let oracle = 240;
    for (let t = 0; t <= 240; t += .025) if (sihangSouthBank({ x: origin.x + direction.x * t, z: origin.z + direction.z * t })) {
      oracle = t; break;
    }
    assert.ok(clipped <= oracle + 1e-7 && oracle - clipped < .026, `First protected crossing ${i}`);
  }
  for (const args of [
    [{ x: NaN, z: 0 }, { x: 0, z: 1 }, 10],
    [{ x: 0, z: 0 }, { x: Infinity, z: 1 }, 10],
    [{ x: 0, z: 0 }, { x: 0, z: 1 }, -1],
  ]) assert.throws(() => sihangRiverRayRange(...args), RangeError);
});

test('ROC cloth has the red field, blue upper-hoist canton, twelve white rays, pinned hoist and changing two-axis folds', () => {
  const flag = createSihangFlag(new THREE.MeshStandardMaterial());
  const pole = flag.group.children.find(child => child.geometry?.type === 'CylinderGeometry');
  assert.equal(pole.geometry.parameters.height, 7);
  assert.equal(pole.position.y, 3.5);
  assert.equal(flag.cloth.position.y, 5.85);
  const { geometry, material } = flag.cloth, texture = material.map;
  const pixel = (x, y) => Array.from(texture.image.data.slice((y * 384 + x) * 4, (y * 384 + x) * 4 + 3));
  assert.deepEqual(pixel(300, 200), [194, 25, 38]);
  assert.deepEqual(pixel(10, 240), [14, 43, 126]);
  assert.deepEqual(pixel(96, 192), [255, 255, 255]);
  let transitions = 0, previous = false;
  for (let i = 0; i <= 720; i++) {
    const angle = i / 720 * Math.PI * 2;
    const white = pixel(Math.round(96 + Math.cos(angle) * 36), Math.round(192 + Math.sin(angle) * 36))[0] === 255;
    if (white && !previous) transitions++;
    previous = white;
  }
  assert.equal(transitions, 12, 'Twelve separate sun rays');
  const before = Float32Array.from(geometry.attributes.position.array);
  flag.update(1.4);
  let yChanged = false, zChanged = false;
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    assert.ok(geometry.boundingBox.containsPoint(point));
    assert.ok(point.distanceTo(geometry.boundingSphere.center) < geometry.boundingSphere.radius);
    if (point.x === 0) {
      assert.equal(point.z, 0);
      assert.equal(point.y, before[i * 3 + 1]);
    } else {
      yChanged ||= Math.abs(point.y - before[i * 3 + 1]) > .01;
      zChanged ||= Math.abs(point.z - before[i * 3 + 2]) > .01;
    }
  }
  assert.equal(yChanged && zChanged, true);
  assert.equal(flag.triangles, 768); assert.equal(flag.vertices, 425);
  assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  assert.equal(flag.cloth.rotation.x, 0); assert.equal(flag.cloth.rotation.y, 0);
  assert.equal(typeof flag.cloth.userData.updateFlag, 'function');
  assert.throws(() => flag.update(NaN), RangeError);
});

test('north sandbag positions register real MG profiles without changing the roof AA', () => {
  assert.equal(SIHANG_EMPLACEMENTS.length, 4);
  assert.equal(SIHANG_EMPLACEMENTS[0].profile, 'maxim24aa');
  assert.equal(SIHANG_EMPLACEMENTS[0].altitude, 21.6);
  assert.equal(SIHANG_EMPLACEMENTS[0].altitude, SIHANG_WAREHOUSE.roofY);
  for (const emplacement of SIHANG_EMPLACEMENTS) assert.ok(EMPLACEMENT_PROFILES[emplacement.profile]);
  const entrance = SIHANG_EMPLACEMENTS.find(point => point.id === 'sihang-ground-entrance-mg');
  assert.equal(entrance.profile, 'maxim24'); assert.equal(entrance.altitude, 0);
  assert.ok(entrance.z > SIHANG_WAREHOUSE.minZ && entrance.z < SIHANG_WAREHOUSE.maxZ);
  for (const emplacement of SIHANG_EMPLACEMENTS.filter(point => point.id.startsWith('sihang-north-gate'))) {
    assert.equal(emplacement.profile, 'maxim24');
    assert.ok(emplacement.z < -42 && Math.abs(emplacement.x) > 9);
  }
});

test('the geographic bridge name is 西藏路桥 throughout the owned layout and preview', () => {
  assert.equal(SIHANG_BRIDGE.name, '西藏路桥');
  assert.match(decodeURIComponent(SIHANG_PREVIEW.src), /西藏路桥/);
  assert.match(SIHANG_PREVIEW.alt, /西藏路桥/);
  assert.doesNotMatch(decodeURIComponent(SIHANG_PREVIEW.src), /撤退桥/);
  assert.doesNotMatch(SIHANG_PREVIEW.alt, /撤退桥/);
});
