import test from 'node:test';
import assert from 'node:assert/strict';
import { createSihangCampaign, SIHANG_RULES, sihangDeploymentCount, registerSihangDeployment,
  advanceSihangCampaign, advanceSihangDemolition, sihangSafePosition, sihangEnemyMayAttack } from '../src/sihang-campaign.js';

const soldier = (id, playerUnit = false, z = -25) => ({ id, playerUnit, health: 100, position: { x: 48, y: 0, z } });

test('all four initial squads consume the same 400-person budget and the final replacement cannot overdraw', () => {
  const state = createSihangCampaign();
  for (let index = 0; index < 4; index++) registerSihangDeployment(state, 11);
  assert.equal(state.reserve, 356); assert.equal(state.deployed, 44);
  while (state.reserve > 0) registerSihangDeployment(state, sihangDeploymentCount(state));
  assert.equal(state.deployed, 400); assert.equal(sihangDeploymentCount(state), 0);
  assert.throws(() => registerSihangDeployment(state, 1), RangeError);
});

test('defense lasts four simulated minutes; retreat lasts five, never respawns, and no living AI is silently discarded', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  registerSihangDeployment(state, 11);
  advanceSihangCampaign(state, 239, { friendly: [player, ai] });
  assert.equal(state.stage, 'sihang-defense');
  advanceSihangCampaign(state, 1, { friendly: [player, ai] });
  assert.equal(state.stage, 'sihang-retreat'); assert.equal(state.stageRemaining, 300);
  assert.equal(sihangDeploymentCount(state), 0);
  player.position.z = 45;
  advanceSihangCampaign(state, 1, { friendly: [player, ai], playerSquad: [player], player });
  assert.equal(state.outcome, null); assert.equal(state.playerRetreatOpen, false);
  ai.position.z = 40;
  advanceSihangCampaign(state, 1, { friendly: [player, ai], playerSquad: [player], player });
  assert.equal(state.outcome, 'evacuated'); assert.equal(ai.health, 100);
});

test('a dead AI no longer blocks retreat, while the controlled survivor rather than the original soldier can complete it', () => {
  const state = createSihangCampaign(), original = soldier('original', true), next = soldier('next', true), ai = soldier('ai');
  advanceSihangCampaign(state, 240, { friendly: [original, next, ai] });
  original.health = ai.health = 0; next.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly: [original, next, ai], playerSquad: [original, next], player: next });
  assert.equal(state.outcome, 'evacuated');
});

test('ten-second installation, fuse and continuous defuse are independent; holding F pauses but never rewinds the fuse', () => {
  const state = createSihangCampaign();
  assert.equal(advanceSihangDemolition(state, 5, { operatorId: 'engineer' }), 'installing');
  advanceSihangDemolition(state, 0, { operatorId: 'engineer' });
  assert.equal(state.demolition.installProgress, 5);
  advanceSihangDemolition(state, 1, {});
  assert.equal(state.demolition.installProgress, 0);
  assert.equal(advanceSihangDemolition(state, 10, { operatorId: 'replacement' }), 'armed');
  advanceSihangDemolition(state, 4, {});
  assert.equal(state.demolition.fuseRemaining, 6);
  advanceSihangDemolition(state, 8, { defusing: true, defuserId: 'p' });
  assert.equal(state.demolition.fuseRemaining, 6);
  advanceSihangDemolition(state, 1, {});
  assert.equal(state.demolition.defuseProgress, 0); assert.equal(state.demolition.fuseRemaining, 5);
  assert.equal(advanceSihangDemolition(state, 10, { defusing: true, defuserId: 'p' }), 'disarmed');
  assert.equal(state.demolition.disarmed, 1); assert.equal(state.outcome, null);
});

test('an installed charge survives its installer and is no longer a defense objective after the withdrawal order', () => {
  const state = createSihangCampaign();
  advanceSihangDemolition(state, 10, { operatorId: 'engineer' });
  assert.equal(advanceSihangDemolition(state, 10, {}), 'detonated');
  assert.equal(state.outcome, 'demolished');
  const withdrawing = createSihangCampaign(), player = soldier('p', true);
  advanceSihangDemolition(withdrawing, 10, { operatorId: 'engineer' });
  advanceSihangCampaign(withdrawing, 240, { friendly: [player] });
  advanceSihangDemolition(withdrawing, 30, {});
  assert.equal(withdrawing.outcome, null);
  assert.equal(sihangEnemyMayAttack({ x: 48, z: 32 }), false);
  assert.equal(sihangEnemyMayAttack({ x: 48, z: 31 }), true);
  assert.equal(sihangSafePosition({ x: 48, z: 40, y: 0 }), true, 'a survivor in a south-bank house is already in the concession');
});

test('occupation, exhausted forces, last squad loss and retreat deadline are terminal and cannot flip after later events', () => {
  for (const reason of ['occupied', 'exhausted', 'squad-lost', 'timeout']) {
    const state = createSihangCampaign(), player = soldier('p', true);
    if (reason === 'occupied') advanceSihangCampaign(state, 1, { friendly: [player], captureLost: true });
    if (reason === 'exhausted') { state.reserve = 0; advanceSihangCampaign(state, 1, {}); }
    if (reason === 'squad-lost' || reason === 'timeout') {
      advanceSihangCampaign(state, 240, { friendly: [player] });
      if (reason === 'squad-lost') player.health = 0;
      advanceSihangCampaign(state, reason === 'timeout' ? SIHANG_RULES.retreatSeconds : 1,
        { friendly: [player], playerSquad: [player], player });
    }
    assert.equal(state.outcome, reason);
    player.position.z = 40;
    advanceSihangCampaign(state, 1, { friendly: [player], playerSquad: [player], player });
    assert.equal(state.outcome, reason);
  }
});
