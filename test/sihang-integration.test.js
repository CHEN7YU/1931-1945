import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sihangBattleRoster, sihangSpawns, sihangObjectives, SIHANG_EMPLACEMENTS, sihangEnemyTargetAllowed, sihangEnemyRayRange, sihangRetreatGoal } from '../src/sihang-roster.js';
import { createSihangCampaign, registerSihangDeployment, sihangDeploymentCount, advanceSihangCampaign } from '../src/sihang-campaign.js';
import { createPlayerIdentityStore, PLAYER_IDENTITY_KEY, playerUnitOptions } from '../src/player-identity.js';
import { campaignById, SELECTABLE_CAMPAIGNS } from '../src/campaigns.js';
import { campaignLayout } from '../src/campaign-layout.js';
import { makeWorld } from '../src/battlefield.js';
import { formationPositions } from '../src/battle-roster.js';
import { spawnBlockReason } from '../src/spawns.js';
import { objectiveContainsPosition, circleBlocked } from '../src/core.js';
import { createEmplacement, emplacementPose } from '../src/emplacements.js';
import { friendlyAIFormationName, campaignUnitName } from '../src/battle-units.js';
import { PERFORMANCE_MAPS } from '../src/performance-schema.js';
import { SIHANG_WAREHOUSE as W } from '../src/sihang-layout.js';

test('Sihang deploys four eleven-person squads and ten distinct enemy units without reducing the 20 sappers', () => {
  const roster = sihangBattleRoster(), friendly = roster.filter(unit => unit.team === 'friendly');
  const enemy = roster.filter(unit => unit.team === 'enemy');
  assert.equal(friendly.length, 4); assert.equal(enemy.length, 10);
  assert.equal(friendly.reduce((sum, unit) => sum + unit.memberCount, 0), 44);
  assert.equal(enemy.filter(unit => unit.type === 'infantry' && !unit.sihangDemolition).length, 6);
  assert.deepEqual(enemy.filter(unit => unit.type === 'tank').map(unit => [unit.armorSlot, unit.memberCount]), [[0, 4], [1, 4]]);
  assert.equal(enemy.find(unit => unit.type === 'plane').aircraftCount, 3);
  assert.equal(enemy.find(unit => unit.sihangDemolition).memberCount, 20);
  assert.equal(new Set(roster.map(unit => unit.id)).size, 14);
  assert.throws(() => sihangBattleRoster('tank'), /步兵/);
  assert.match(campaignUnitName(enemy.at(-1)), /爆破/);
  assert.match(friendlyAIFormationName('sihang', playerUnitOptions('sihang')[0].name, 1), /524团/);
});

test('the 400-person ceiling includes all 44 opening soldiers and the last genuine partial replacement', () => {
  const campaign = createSihangCampaign();
  for (let i = 0; i < 4; i++) registerSihangDeployment(campaign, 11);
  assert.equal(campaign.reserve, 356);
  while (campaign.reserve > 11) registerSihangDeployment(campaign, sihangDeploymentCount(campaign));
  assert.equal(campaign.reserve, 4);
  registerSihangDeployment(campaign, sihangDeploymentCount(campaign));
  assert.equal(campaign.deployed, 400); assert.equal(sihangDeploymentCount(campaign), 0);
  assert.throws(() => registerSihangDeployment(campaign, 1), /budget/);
  const retreat = createSihangCampaign();
  advanceSihangCampaign(retreat, 240);
  assert.equal(sihangDeploymentCount(retreat), 0);
});

test('old valid v1 identities acquire only the new default, without overwriting existing names or choices', () => {
  const original = JSON.stringify({ version: 1, identity: { nickname: '守望者', customName: '家乡队',
    selections: { 'taierzhuang-fort': 'custom', nanjing: 'training' } } });
  let saved = original, writes = 0;
  const store = createPlayerIdentityStore({ storage: () => ({ getItem: () => saved,
    setItem: (key, value) => { assert.equal(key, PLAYER_IDENTITY_KEY); saved = value; writes++; } }) });
  assert.equal(store.status.problem, false); assert.equal(writes, 0);
  assert.deepEqual(store.snapshot, { nickname: '守望者', customName: '家乡队',
    selections: { sihang: '524', 'taierzhuang-fort': 'custom', nanjing: 'training' } });
  store.update({ selections: { sihang: 'custom' } });
  assert.equal(writes, 1); assert.equal(store.snapshot.customName, '家乡队');
  assert.deepEqual(playerUnitOptions('sihang').map(unit => unit.id), ['524', 'custom']);
});

test('identity migration does not repair or rewrite invalid old records', () => {
  const invalid = JSON.stringify({ version: 1, identity: { nickname: '旧记录', customName: '名字',
    selections: { 'taierzhuang-fort': '88', nanjing: '88' } } });
  let writes = 0;
  const store = createPlayerIdentityStore({ storage: () => ({ getItem: () => invalid, setItem: () => writes++ }), warn() {} });
  assert.equal(store.status.problem, true); assert.equal(writes, 0);
  assert.equal(store.snapshot.nickname, '玩家');
});

test('new campaign has an original inline schematic, remains separate from locked Shanghai, and accepts performance context', () => {
  const campaign = campaignById('sihang');
  assert.equal(campaign.year, 1937); assert.equal(campaign.locked, undefined);
  assert.ok(SELECTABLE_CAMPAIGNS.includes(campaign));
  assert.equal(campaignLayout('sihang').campaign, 'sihang');
  assert.equal(campaignById('shanghai').locked, true);
  assert.ok(campaign.preview.src.startsWith('data:image/svg+xml;'));
  assert.match(decodeURIComponent(campaign.preview.src), /非历史照片/);
  assert.ok(PERFORMANCE_MAPS.includes('sihang'));
});

test('neutral-bank target filter excludes soldiers and vehicles at or south of z32', () => {
  for (const z of [-90, 8, 31.99]) assert.equal(sihangEnemyTargetAllowed({ position: { x: 48, y: 0, z } }), true);
  for (const z of [32, 36, 100]) assert.equal(sihangEnemyTargetAllowed({ position: { x: 48, y: 50, z } }), false);
  assert.equal(sihangEnemyTargetAllowed(null), false);
  assert.equal(sihangEnemyRayRange({ x: 48, z: 8 }, { x: 0, z: 1 }, 220), 24);
  assert.equal(sihangEnemyRayRange({ x: 48, z: 32 }, { x: 0, z: -1 }, 220), 0);
  assert.equal(sihangEnemyRayRange({ x: 48, z: 4 }, { x: 0, z: -1 }, 220), 220);
  assert.equal(sihangRetreatGoal({ index: 0, position: { x: 0, y: W.floorHeight, z: -25 } }).z, 4);
  assert.equal(sihangRetreatGoal({ index: 0, position: { x: 48, y: 0, z: 15 } }).z, 36.5);
});

test('real warehouse geometry supports all four complete opening formations, enemy staging, capture height and rooftop gunner', () => {
  const scene = new THREE.Scene();
  const world = makeWorld(scene, (kind, color) => new THREE.MeshStandardMaterial({ color }), campaignLayout('sihang'));
  const points = sihangSpawns(), occupied = [];
  for (const unit of sihangBattleRoster().filter(unit => unit.type === 'infantry')) {
    const spawn = points.find(point => point.id === unit.spawnId);
    assert.equal(spawnBlockReason(spawn, 'infantry', [], world.obstacles), null, spawn.id);
    const positions = formationPositions(spawn, unit.memberCount, world.obstacles, occupied);
    assert.equal(positions.length, unit.memberCount);
    for (const position of positions) {
      const y = world.walkHeight(position.x, position.z, spawn.altitude);
      assert.equal(y, spawn.altitude, `${spawn.id} actual supported spawn floor`);
      occupied.push({ ...position, y });
    }
  }
  const point = sihangObjectives()[0];
  assert.equal(objectiveContainsPosition(point, { x: -4, y: 0, z: -25 }), true);
  assert.equal(objectiveContainsPosition(point, { x: -4, y: W.floorHeight, z: -25 }), false);
  const aa = createEmplacement(SIHANG_EMPLACEMENTS[0]), pose = emplacementPose(aa, aa.altitude);
  assert.equal(circleBlocked(pose.operator.x, pose.operator.z, .43, world.obstacles, pose.operator.y), false);
  assert.equal(world.walkHeight(pose.operator.x, pose.operator.z, pose.operator.y), W.roofY);
  assert.equal(world.civilians.length, 36);
  assert.equal(world.ferries, undefined);
});
