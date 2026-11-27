import test from 'node:test';
import assert from 'node:assert/strict';
import { civilianRecoveryDue, installCivilianRecovery, stalledCivilianCandidates, endCivilianRecoveryWait, expireCivilianShoreWait } from '../src/civilian-recovery.js';
import { createNanjingCampaign, nanjingCivilianEvacuationStatus, advanceNanjingCampaign, NANJING_CIVILIAN_FINAL_WAIT } from '../src/nanjing-campaign.js';

const dataFor = () => ({ waitingSlot: { x: 10, z: 0 }, route: [{ x: 5, z: 0 }, { x: 10, z: 0 }],
  waypoint: 0, arrived: false, dead: false, evacuated: false, active: true });

test('final recovery uses twelve seconds of simulated lack of progress, not render time or a short wait', () => {
  const data = dataFor(), position = { x: 0, z: 0 };
  assert.equal(civilianRecoveryDue(data, position, 0), false);
  assert.equal(civilianRecoveryDue(data, position, 11.9), false);
  assert.equal(civilianRecoveryDue(data, position, 12), true);
  data.finalRecovery.retryAt = 15;
  assert.equal(civilianRecoveryDue(data, position, 14), false);
});

test('real progress keeps an ordinary walking civilian out of recovery', () => {
  const data = dataFor();
  for (let time = 0; time <= 30; time += 2)
    assert.equal(civilianRecoveryDue(data, { x: time * .1, z: 0 }, time), false);
});

test('repeated replanning without moving cannot postpone recovery forever', () => {
  const data = dataFor(), position = { x: 0, z: 0 };
  civilianRecoveryDue(data, position, 0);
  for (let time = 2; time < 12; time += 2) {
    data.route = data.route.map(p => ({ ...p }));
    assert.equal(civilianRecoveryDue(data, position, time), false);
  }
  assert.equal(civilianRecoveryDue(data, position, 12), true);
});

test('installing a real recovery route neither kills nor marks a person arrived or evacuated', () => {
  const data = dataFor();
  civilianRecoveryDue(data, { x: 0, z: 0 }, 0);
  installCivilianRecovery(data, [{ x: 3, z: 1 }, { x: 10, z: 0 }], 12);
  assert.equal(data.finalRecovery.active, true);
  assert.equal(data.arrived, false); assert.equal(data.evacuated, false); assert.equal(data.dead, false);
  assert.equal(data.waypoint, 0);
  assert.throws(() => installCivilianRecovery(data, [], 13), /real navigable route/);
});

test('installing routes and consuming their starting waypoint cannot disguise a stationary civilian as progressing', () => {
  const data = dataFor(), position = { x: 0, z: 0 };
  civilianRecoveryDue(data, position, 0);
  for (const time of [12, 14, 16]) {
    assert.equal(civilianRecoveryDue(data, position, time), true);
    data.finalRecovery.attempts++;
    installCivilianRecovery(data, [position, data.waitingSlot], time);
    civilianRecoveryDue(data, position, time);
    data.waypoint++;
    civilianRecoveryDue(data, position, time);
  }
  assert.equal(data.finalRecovery.lastProgress, 0);
  assert.equal(stalledCivilianCandidates([{ userData: data }], 16).length, 1);
});

test('ending the wait explicitly records only stalled people as unrescued, not dead or successfully evacuated', () => {
  const campaign = createNanjingCampaign(); campaign.stage = 'withdrawal-to-boats';
  const stalled = { userData: { ...dataFor(), health: 100, finalRecovery: { attempts: 3, lastProgress: 0 } } };
  const moving = { userData: { ...dataFor(), health: 100, finalRecovery: { attempts: 3, lastProgress: 19 } } };
  assert.equal(stalledCivilianCandidates([stalled, moving], 20).length, 1);
  assert.equal(campaign.civiliansUnrescued, 0);
  assert.equal(nanjingCivilianEvacuationStatus(campaign, [stalled]).ready, false);
  assert.equal(endCivilianRecoveryWait(campaign, [stalled, moving], 20), 1);
  assert.equal(campaign.civiliansUnrescued, 1);
  assert.equal(campaign.civiliansEvacuated, 0); assert.equal(campaign.civilianCasualties, 0);
  assert.equal(stalled.userData.health, 100); assert.equal(stalled.userData.dead, false);
  assert.equal(nanjingCivilianEvacuationStatus(campaign, [stalled]).ready, true);
  assert.equal(nanjingCivilianEvacuationStatus(campaign, [stalled, moving]).ready, false);
  assert.equal(campaign.playerEscaped, false);
  assert.equal(endCivilianRecoveryWait(campaign, [stalled], 20), 0, 'a person is never counted twice');
});

test('waiting and boarded civilians are never abandoned and still prevent squad withdrawal', () => {
  const campaign = createNanjingCampaign(); campaign.stage = 'withdrawal-to-boats';
  const person = extra => ({ userData: { ...dataFor(),
    finalRecovery: { attempts: 4, lastProgress: 0 }, ...extra } });
  const people = [person({ arrived: true }), person({ boarding: true }), person({ evacuated: true }),
    person({ dead: true }), person({ finalRecovery: { attempts: 2, lastProgress: 0 } })];
  assert.equal(stalledCivilianCandidates(people, 20).length, 0);
  campaign.civiliansWaiting = 1; campaign.civiliansAboard = 1;
  assert.equal(endCivilianRecoveryWait(campaign, people, 20), 0);
  assert.equal(campaign.civiliansWaiting, 1); assert.equal(campaign.civiliansAboard, 1);
  assert.equal(nanjingCivilianEvacuationStatus(campaign, people).ready, false);
  campaign.stage = 'dock-defense';
  assert.throws(() => endCivilianRecoveryWait(campaign, people, 20), /final withdrawal/);
});

test('final deadline marks only people on shore unrescued while boats must really cross', () => {
  const campaign = createNanjingCampaign(); campaign.stage = 'withdrawal-to-boats';
  campaign.civiliansWaiting = 2; campaign.civiliansAboard = 1; campaign.civiliansEvacuated = 4;
  const person = extra => ({ userData: { ...dataFor(), ...extra } });
  const road = person({}), waiting = person({ arrived: true }), boarding = person({ arrived: true, boarding: true });
  const aboard = person({ arrived: true, boarding: true }), dead = person({ dead: true });
  const queue = [waiting], ferry = { userData: { passengers: [aboard], boarding: { civilian: boarding } } };
  const people = [road, waiting, boarding, aboard, dead];
  advanceNanjingCampaign(campaign, NANJING_CIVILIAN_FINAL_WAIT - .01);
  assert.equal(expireCivilianShoreWait(campaign, people, [ferry], queue), 0);
  advanceNanjingCampaign(campaign, 0);
  assert.equal(campaign.finalWithdrawalElapsed, NANJING_CIVILIAN_FINAL_WAIT - .01);
  advanceNanjingCampaign(campaign, .01);
  assert.equal(expireCivilianShoreWait(campaign, people, [ferry], queue), 3);
  assert.equal(campaign.civiliansUnrescued, 3);
  assert.equal(campaign.civiliansEvacuated, 4);
  assert.equal(campaign.civiliansAboard, 1);
  assert.equal(campaign.civiliansWaiting, 0);
  assert.equal(aboard.userData.unrescued, undefined);
  assert.equal(boarding.userData.boarding, false);
  assert.equal(ferry.userData.boarding, null);
  assert.deepEqual(queue, []);
  assert.equal(nanjingCivilianEvacuationStatus(campaign, people).ready, false);
  assert.equal(expireCivilianShoreWait(campaign, people, [ferry], queue), 0);
  campaign.civiliansAboard = 0; aboard.userData.evacuated = true;
  assert.equal(nanjingCivilianEvacuationStatus(campaign, people).ready, true);
});

test('deadline returns an interrupted gangplank boarder to shore before releasing the ferry', () => {
  const campaign = createNanjingCampaign();
  Object.assign(campaign, { stage: 'withdrawal-to-boats', finalWithdrawalElapsed: NANJING_CIVILIAN_FINAL_WAIT,
    civiliansWaiting: 1 });
  const civilian = { userData: { ...dataFor(), arrived: true, boarding: true } };
  const returnPath = [{ x: -120, y: .47, z: -83.2 }, { x: -120, y: 0, z: -81.6 }];
  const boarding = { civilian, path: [{ x: -120, y: .47, z: -85 }], returnPath };
  const ferry = { userData: { passengers: [], boarding } };
  assert.equal(expireCivilianShoreWait(campaign, [civilian], [ferry], []), 1);
  assert.equal(civilian.userData.unrescued, true);
  assert.equal(civilian.userData.boarding, true);
  assert.equal(ferry.userData.boarding, boarding);
  assert.equal(boarding.returningToShore, true);
  assert.deepEqual(boarding.path, returnPath);
  assert.equal(campaign.civiliansWaiting, 0);
});
