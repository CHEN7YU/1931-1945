import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGNS, SELECTABLE_CAMPAIGNS, DEFAULT_CAMPAIGN, campaignById } from '../src/campaigns.js';
import { campaignLayout } from '../src/campaign-layout.js';
import { capturedSpawnPoints, supportsSquad, deploymentBlockReason, SQUADS, recommendedSpawn } from '../src/spawns.js';
import { createMortar, MORTAR, mortarTarget, stowMortar, adjustMortarRange, mortarObjectiveRanges } from '../src/mortar.js';

test('the launcher shows only Taierzhuang fort while retaining the hidden streets layout and locked placeholders', () => {
  assert.equal(CAMPAIGNS.length, 4);
  assert.deepEqual(Object.keys(SQUADS), ['infantry', 'tank', 'plane']);
  assert.deepEqual(SELECTABLE_CAMPAIGNS.filter(campaign => !campaign.locked).map(campaign => campaign.id), ['taierzhuang-fort']);
  assert.equal(DEFAULT_CAMPAIGN.id, 'taierzhuang-fort');
  assert.equal(campaignById('taierzhuang-streets').hidden, true);
  assert.equal(SELECTABLE_CAMPAIGNS.some(campaign => campaign.id === 'taierzhuang-streets'), false);
  const layouts = CAMPAIGNS.filter(campaign => !campaign.locked).map(campaign => campaignLayout(campaign.id));
  assert.equal(layouts[0].town, undefined);
  assert.ok(layouts.slice(1).every(layout => layout.town.pieces.length > 100 && layout.town.obstacles.length > 100));
  assert.equal(new Set(layouts.map(layout => JSON.stringify(layout.objectives))).size, 2);
  for (const id of ['shanghai', 'nanjing']) {
    assert.equal(campaignById(id).locked, true);
    assert.throws(() => campaignLayout(id), /awaiting the user design brief/);
  }
  assert.throws(() => campaignById('fake'), RangeError);
});

test('captured positions flex around an obstruction and disappear when ownership changes', () => {
  const objective = { id: 'A', name: '街口', x: 0, z: 0, owner: 'friendly' };
  const base = { x: 0, z: 80 };
  const points = capturedSpawnPoints([objective], base, 'infantry', point => point.x > 3);
  assert.equal(points.length, 1);
  assert.ok(points[0].x > 3);
  assert.equal(supportsSquad(points[0], 'infantry'), true);
  assert.equal(supportsSquad(points[0], 'plane'), false);
  assert.equal(capturedSpawnPoints([objective], base, 'tank', () => true).length, 0);
  assert.equal(supportsSquad({ kind: 'objective-tank' }, 'tank'), false);
  assert.equal(supportsSquad({ kind: 'garage' }, 'tank'), true);
  objective.owner = 'enemy';
  assert.equal(capturedSpawnPoints([objective], base, 'infantry', () => true).length, 0);
  assert.equal(deploymentBlockReason('dead', [{ health: 0 }], 'infantry', 'infantry'), null);
  assert.ok(deploymentBlockReason('playing', [{ health: 100 }], 'infantry', 'infantry'));
});

test('squad selection recommends the closest safe compatible spawn, not an unsafe forward point', () => {
  const points = [
    { id: 'base', team: 'friendly', kind: 'base', x: 0, z: 80 },
    { id: 'front', team: 'friendly', kind: 'objective', x: 0, z: 30 },
    { id: 'garage', team: 'friendly', kind: 'garage', x: 0, z: 85 },
    { id: 'enemy', team: 'enemy', kind: 'base', x: 0, z: 0 },
  ];
  const objectives = [{ x: 0, z: 0, owner: 'enemy' }];
  assert.equal(recommendedSpawn(points, 'infantry', objectives, () => true).id, 'front');
  assert.equal(recommendedSpawn(points, 'infantry', objectives, point => point.id !== 'front').id, 'base');
  assert.equal(recommendedSpawn(points, 'tank', objectives, () => true).id, 'garage');
  assert.equal(recommendedSpawn(points, 'plane', objectives, () => true), null);
  assert.equal(recommendedSpawn(points, 'infantry', objectives, () => false), null);
});

test('mortar target uses configured range without clamping out-of-map targets into fake hits', () => {
  const mortar = createMortar();
  assert.equal(mortar.ammo, 12);
  for (const range of [50, 100, 250]) {
    const target = mortarTarget({ x: 4, z: 10 }, .7, range, () => 2);
    assert.ok(Math.abs(Math.hypot(target.x - 4, target.z - 10) - range) < 1e-10);
    assert.equal(target.y, 2.15);
  }
  assert.ok(mortarTarget({ x: 0, z: 0 }, 0, MORTAR.maxRange, () => 0).z < -108);
  assert.throws(() => mortarTarget({ x: 0, z: 0 }, 0, 49, () => 0), RangeError);
  assert.throws(() => mortarTarget({ x: 0, z: 0 }, 0, 251, () => 0), RangeError);
  mortar.phase = 'ready'; mortar.ammo = 3; mortar.nextShot = 10;
  stowMortar(mortar);
  assert.equal(mortar.phase, 'carrying');
  assert.equal(mortar.ammo, 3);
  assert.equal(mortar.nextShot, 10);
});

test('mouse elevation adjusts mortar range only while aiming and preserves range bounds', () => {
  const mortar = createMortar();
  adjustMortarRange(mortar, -100);
  assert.equal(mortar.distance, 100);
  mortar.phase = 'ready';
  adjustMortarRange(mortar, -20);
  assert.equal(mortar.distance, 110);
  adjustMortarRange(mortar, 20);
  assert.equal(mortar.distance, 100);
  adjustMortarRange(mortar, -10000);
  assert.equal(mortar.distance, 250);
  adjustMortarRange(mortar, 10000);
  assert.equal(mortar.distance, 50);
  assert.throws(() => adjustMortarRange(mortar, NaN), RangeError);
});

test('mortar objective hints show true horizontal distances and follow wrapped mouse heading', () => {
  const position = { x: 0, z: 0 }, points = [
    { id: 'A', name: 'North', x: 0, z: -80 },
    { id: 'B', name: 'East', x: 100, z: 0 },
    { id: 'C', name: 'Near', x: 0, z: 20 },
  ];
  const north = mortarObjectiveRanges(position, 0, points);
  assert.deepEqual(north.map(point => point.distance), [80, 100, 20]);
  assert.equal(north[0].centered, true);
  assert.equal(north[2].inRange, false);
  assert.equal(mortarObjectiveRanges(position, -Math.PI / 2, points)[1].centered, true);
  assert.equal(mortarObjectiveRanges(position, Math.PI * 2, points)[0].centered, true);
  const changed = mortarObjectiveRanges({ x: 0, z: 10 }, 0, points);
  assert.equal(changed[0].distance, 90);
  assert.throws(() => mortarObjectiveRanges(position, NaN, points), RangeError);
});
