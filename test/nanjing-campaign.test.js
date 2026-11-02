import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NANJING_BOAT_CAPACITY, NANJING_BOAT_COUNT, NANJING_OBJECTIVES, NANJING_SPAWNS,
  NANJING_GATE_CAPTURE_SECONDS, NANJING_STAGE_SECONDS, activateNanjingDock, advanceNanjingCampaign, advanceNanjingGateCapture, boardCivilian,
  completeNanjingCrossing, createNanjingCampaign, departNanjingBoat, overrunNanjingDock, recordNanjingSquadEvacuation,
  isNanjingSpawnAvailable, nanjingMissionVoice, registerCivilianArrival, registerCivilianCasualties, returnNanjingBoat,
} from '../src/nanjing-campaign.js';
import { NANJING_COURTYARDS, NANJING_GATE_POSITIONS, NANJING_GATE_TUNNEL } from '../src/nanjing-layout.js';

test('only enemy infantry holding the west side inside the second gate alone can finish its capture countdown', () => {
  const campaign = createNanjingCampaign();
  assert.ok(NANJING_OBJECTIVES[0].x < 0);
  assert.equal(NANJING_OBJECTIVES[0].z, NANJING_COURTYARDS[1].centerZ);
  assert.ok(NANJING_OBJECTIVES[0].z < NANJING_GATE_POSITIONS[1] - NANJING_GATE_TUNNEL.depth / 2);
  advanceNanjingGateCapture(campaign, 9, false, true);
  assert.equal(campaign.gateCaptureSeconds, 9);
  advanceNanjingGateCapture(campaign, 30, true, true);
  assert.equal(campaign.gateCaptureSeconds, 0);
  assert.equal(campaign.gateContested, true);
  advanceNanjingGateCapture(campaign, 10, false, true);
  advanceNanjingGateCapture(campaign, 1, false, false);
  assert.equal(campaign.gateCaptureSeconds, 0);
  advanceNanjingGateCapture(campaign, NANJING_GATE_CAPTURE_SECONDS - .01, false, true);
  assert.equal(campaign.outcome, null);
  advanceNanjingGateCapture(campaign, .01, false, true);
  assert.equal(campaign.outcome, 'gate-overrun');
  const withdrawing = createNanjingCampaign();
  advanceNanjingCampaign(withdrawing, NANJING_STAGE_SECONDS);
  advanceNanjingGateCapture(withdrawing, 30, false, true);
  assert.equal(withdrawing.outcome, null);
  assert.equal(withdrawing.gateCaptureSeconds, 0);
  assert.throws(() => advanceNanjingGateCapture(createNanjingCampaign(), -1, false, true), RangeError);
});

test('mission voice announces each remaining minute once, withdraws at zero and restarts at the dock', () => {
  const campaign = createNanjingCampaign();
  assert.equal(NANJING_STAGE_SECONDS, 180);
  for (let minute = 3; minute > 0; minute--) {
    assert.equal(nanjingMissionVoice(campaign), `nanjing-gate-${minute}`);
    for (let second = 0; second < 60; second++) {
      assert.equal(nanjingMissionVoice(campaign), null);
      advanceNanjingCampaign(campaign, 1);
    }
  }
  assert.equal(campaign.stage, 'withdrawal');
  assert.equal(nanjingMissionVoice(campaign), 'nanjing-withdrawal');
  assert.equal(nanjingMissionVoice(campaign), null);
  advanceNanjingCampaign(campaign, 120);
  assert.equal(nanjingMissionVoice(campaign), null);
  activateNanjingDock(campaign);
  assert.equal(nanjingMissionVoice(campaign), 'nanjing-dock-3');
  advanceNanjingCampaign(campaign, 60);
  assert.equal(nanjingMissionVoice(campaign), 'nanjing-dock-2');
  assert.equal(nanjingMissionVoice(campaign), null);
  assert.equal(nanjingMissionVoice(createNanjingCampaign()), 'nanjing-gate-3');
});

test('Nanjing campaign uses dedicated gate, dock, and three-direction assault positions', () => {
  assert.equal(NANJING_OBJECTIVES.length, 2);
  assert.equal(NANJING_OBJECTIVES[0].name, '中华门第二道门内西侧');
  assert.equal(NANJING_OBJECTIVES[1].name, '上新河渡口');
  assert.equal(NANJING_OBJECTIVES.filter(point => point.capturePoint).length, 1);
  assert.equal(NANJING_OBJECTIVES.find(point => point.id === 'gate').capturePoint, true);
  assert.equal(NANJING_OBJECTIVES.find(point => point.id === 'dock').capturePoint, false);
  assert.equal(NANJING_SPAWNS.find(spawn => spawn.id === 'nanjing-gate').team, 'friendly');
  assert.deepEqual(
    NANJING_SPAWNS.filter(spawn => spawn.team === 'friendly' && spawn.kind === 'base' && spawn.id.startsWith('nanjing-gate') && !spawn.initialOnly)
      .map(spawn => spawn.name),
    ['中华门北墙内侧', '中华门北侧城墙 · 反扑阵地', '中华门东侧城墙', '中华门东侧藏兵洞'],
  );
  assert.ok(NANJING_SPAWNS.filter(spawn => ['nanjing-gate-wall', 'nanjing-gate-cave'].includes(spawn.id)).every(spawn => spawn.aiOnly));
  assert.ok(NANJING_SPAWNS.filter(spawn => spawn.initialOnly).every(spawn => !isNanjingSpawnAvailable(spawn, false)));
  assert.deepEqual(
    NANJING_SPAWNS.filter(spawn => spawn.team === 'friendly' && !spawn.aiOnly &&
      isNanjingSpawnAvailable(spawn, false)).map(spawn => spawn.id),
    ['nanjing-gate', 'nanjing-gate-north-wall'],
  );
  assert.deepEqual(
    NANJING_SPAWNS.filter(spawn => spawn.team === 'friendly' && !spawn.aiOnly &&
      isNanjingSpawnAvailable(spawn, true)).map(spawn => spawn.id),
    ['nanjing-west-dock'],
  );
  assert.deepEqual(
    ['nanjing-north-1', 'nanjing-east-1', 'nanjing-south-1'].filter(id => NANJING_SPAWNS.some(spawn => spawn.id === id)),
    ['nanjing-north-1', 'nanjing-east-1', 'nanjing-south-1'],
  );
  assert.equal(NANJING_SPAWNS.filter(spawn => spawn.team === 'enemy').length, 27);
});

test('three-minute gate defense ends reinforcements and requires reaching the dock to start its defense', () => {
  const campaign = createNanjingCampaign();
  assert.equal(campaign.stageRemaining, NANJING_STAGE_SECONDS);
  assert.equal(campaign.reinforcementStopped, false);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS - 1);
  assert.equal(campaign.stage, 'gate-defense');
  advanceNanjingCampaign(campaign, 1);
  assert.equal(campaign.stage, 'withdrawal');
  assert.equal(campaign.reinforcementStopped, true);
  assert.equal(campaign.stageRemaining, 0);
  advanceNanjingCampaign(campaign, 600);
  assert.equal(campaign.stage, 'withdrawal', 'dock clock must not run while the player is still en route');
  assert.equal(activateNanjingDock(campaign), true);
  assert.equal(campaign.stage, 'dock-defense');
  assert.equal(campaign.stageRemaining, NANJING_STAGE_SECONDS);
  assert.equal(campaign.reinforcementStopped, false, 'dock attack must allow its own reinforcements');
  assert.equal(activateNanjingDock(campaign), false);
});

test('dock evacuation keeps the player last and distinguishes successful escape from being overrun', () => {
  const campaign = createNanjingCampaign();
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  activateNanjingDock(campaign);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  assert.equal(campaign.stage, 'withdrawal-to-boats');
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), false);
  for (let index = 0; index < 4; index++) {
    assert.equal(recordNanjingSquadEvacuation(campaign, `ai-${index}`), true);
  }
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai-0'), false);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), true);
  assert.equal(campaign.outcome, 'evacuated');

  const fallen = createNanjingCampaign();
  overrunNanjingDock(fallen);
  assert.equal(fallen.outcome, 'fallen');
});

test('civilians board five ten-person boats without losing count', () => {
  const campaign = createNanjingCampaign();
  assert.equal(campaign.boats.length, NANJING_BOAT_COUNT);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  assert.equal(activateNanjingDock(campaign), true);
  registerCivilianArrival(campaign, 23);
  assert.equal(registerCivilianCasualties(campaign, 3), 3);
  for (let index = 0; index < NANJING_BOAT_CAPACITY; index++) assert.equal(boardCivilian(campaign, 0), true);
  assert.equal(campaign.civiliansEvacuated, 0, 'boarding is not a completed crossing');
  assert.equal(campaign.civiliansAboard, NANJING_BOAT_CAPACITY);
  assert.equal(campaign.boats[0].returning, true);
  assert.equal(boardCivilian(campaign, 0), false);
  assert.equal(returnNanjingBoat(campaign, 0), false, 'a loaded boat cannot return without completing the crossing');
  assert.equal(completeNanjingCrossing(campaign, 0), true);
  assert.equal(completeNanjingCrossing(campaign, 0), false, 'crossings cannot be counted twice');
  assert.equal(returnNanjingBoat(campaign, 0), true);
  for (let index = 0; index < NANJING_BOAT_CAPACITY; index++) assert.equal(boardCivilian(campaign, 1), true);
  assert.equal(completeNanjingCrossing(campaign, 1), true);
  assert.equal(campaign.civiliansEvacuated, 20);
  assert.equal(campaign.civiliansWaiting, 0);
  assert.equal(campaign.civiliansAboard, 0);
  assert.equal(campaign.civiliansArrived, campaign.civiliansEvacuated + campaign.civilianCasualties +
    campaign.civiliansWaiting + campaign.civiliansAboard);
});

test('civilians can gather at the dock but cannot board or depart before the defenders arrive', () => {
  const campaign = createNanjingCampaign();
  registerCivilianArrival(campaign, 5);
  assert.equal(boardCivilian(campaign, 0), false);
  assert.equal(departNanjingBoat(campaign, 0), false);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  assert.equal(campaign.stage, 'withdrawal');
  assert.equal(boardCivilian(campaign, 0), false);
  assert.equal(activateNanjingDock(campaign), true);
  assert.equal(boardCivilian(campaign, 0), true);
  assert.equal(campaign.civiliansWaiting, 4);
});

test('the last partially loaded boat can cross and civilians must be safe before any squad withdraws', () => {
  const campaign = createNanjingCampaign();
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  activateNanjingDock(campaign);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  campaign.requiredAISquads = 1;
  registerCivilianArrival(campaign, 7);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai'), false);
  for (let index = 0; index < 7; index++) boardCivilian(campaign, 0);
  assert.equal(campaign.civiliansEvacuated, 0);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai'), false);
  assert.equal(departNanjingBoat(campaign, 0), true);
  assert.equal(departNanjingBoat(campaign, 0), false);
  completeNanjingCrossing(campaign, 0);
  assert.equal(campaign.civiliansEvacuated, 7);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), false);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai'), true);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), true);
  assert.equal(campaign.outcome, 'evacuated');
});

test('a dock overrun is terminal and en-route civilian losses do not subtract from the dock queue', () => {
  const campaign = createNanjingCampaign();
  registerCivilianArrival(campaign, 5);
  registerCivilianCasualties(campaign, 2, false);
  assert.equal(campaign.civiliansWaiting, 5);
  assert.equal(campaign.civilianCasualties, 2);
  assert.equal(campaign.civilianEnRouteCasualties, 2);
  registerCivilianCasualties(campaign, 1);
  assert.equal(campaign.civiliansWaiting, 4);
  assert.equal(campaign.civilianCasualties, 3);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  activateNanjingDock(campaign);
  advanceNanjingCampaign(campaign, NANJING_STAGE_SECONDS);
  campaign.requiredAISquads = 0;
  overrunNanjingDock(campaign);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), false);
  assert.equal(campaign.outcome, 'fallen');
});

test('a complete six-minute defense waits for arrival, actual crossings, and surviving AI squads', () => {
  const campaign = createNanjingCampaign();
  for (let second = 0; second < NANJING_STAGE_SECONDS - 1; second++) advanceNanjingCampaign(campaign, 1);
  assert.equal(campaign.stage, 'gate-defense');
  assert.equal(campaign.stageRemaining, 1);
  assert.equal(activateNanjingDock(campaign), false);
  advanceNanjingCampaign(campaign, 1);
  assert.equal(campaign.stage, 'withdrawal');
  for (let second = 0; second < 90; second++) advanceNanjingCampaign(campaign, 1);
  assert.equal(campaign.stage, 'withdrawal');
  assert.equal(campaign.dockActivated, false);
  assert.equal(activateNanjingDock(campaign), true);
  registerCivilianArrival(campaign, 57);
  registerCivilianCasualties(campaign, 4);
  for (let boat = 0; boat < NANJING_BOAT_COUNT; boat++) {
    for (let seat = 0; seat < NANJING_BOAT_CAPACITY; seat++) boardCivilian(campaign, boat);
  }
  assert.equal(campaign.civiliansEvacuated, 0);
  assert.equal(campaign.civiliansAboard, 50);
  for (let boat = 0; boat < NANJING_BOAT_COUNT; boat++) {
    completeNanjingCrossing(campaign, boat);
    returnNanjingBoat(campaign, boat);
  }
  for (let seat = 0; seat < 3; seat++) boardCivilian(campaign, 0);
  for (let second = 0; second < NANJING_STAGE_SECONDS - 1; second++) advanceNanjingCampaign(campaign, 1);
  assert.equal(campaign.stage, 'dock-defense');
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai-0'), false);
  advanceNanjingCampaign(campaign, 1);
  assert.equal(campaign.stage, 'withdrawal-to-boats');
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai-0'), false);
  departNanjingBoat(campaign, 0);
  completeNanjingCrossing(campaign, 0);
  assert.equal(campaign.civiliansEvacuated, 53);
  assert.equal(campaign.civiliansEvacuated + campaign.civilianCasualties, 57);
  campaign.requiredAISquads = 2;
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai-0'), true);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), false);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'ai-1'), true);
  assert.equal(recordNanjingSquadEvacuation(campaign, 'player', true), true);
  assert.equal(advanceNanjingCampaign(campaign, 1), 'evacuated');
});

test('campaign rejects invalid time and civilian counts', () => {
  const campaign = createNanjingCampaign();
  assert.throws(() => advanceNanjingCampaign(campaign, -1), RangeError);
  assert.throws(() => registerCivilianArrival(campaign, 1.5), RangeError);
  assert.throws(() => registerCivilianCasualties(campaign, -1), RangeError);
});
