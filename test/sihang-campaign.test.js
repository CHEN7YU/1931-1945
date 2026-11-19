import test from 'node:test';
import assert from 'node:assert/strict';
import { createSihangCampaign, SIHANG_RULES, sihangDeploymentCount, registerSihangDeployment,
  advanceSihangCampaign, advanceSihangDemolition, sihangSafePosition, sihangEnemyMayAttack,
  reopenSihangPlayerEvacuation,
  sihangRetreatDeploymentCount, registerSihangRetreatSquad, sihangRetreatStatus,
  returnSihangRetreatSquadToReserve, transferSihangRetreatSquad,
  startSihangWithdrawalWave, advanceSihangWithdrawalWave, sihangWaveAssemblyRemaining,
  sihangWithdrawalBatch } from '../src/sihang-campaign.js';

const soldier = (id, playerUnit = false, z = -25) => ({ id, playerUnit, health: 100, position: { x: 48, y: 0, z } });

test('taking over existing AI preserves the troop budget and original withdrawal identities', () => {
  const state = createSihangCampaign(), ai = soldier('ai'), other = soldier('other');
  registerSihangDeployment(state, 11);
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [ai, other] });
  const budget = [state.reserve, state.retreatReserve, state.deployed, state.retreatTotal];
  const identities = [...state.retreatIds];
  transferSihangRetreatSquad(state, [ai]);
  assert.deepEqual([state.reserve, state.retreatReserve, state.deployed, state.retreatTotal], budget);
  assert.deepEqual(state.retreatIds, identities);
  assert.deepEqual(state.aiRetreatIds, ['other']);
  assert.throws(() => transferSihangRetreatSquad(state, [ai]), RangeError);
  ai.playerUnit = true;
  state.assemblyReleased = true;
  ai.position = { x: 80, y: 0, z: 15 };
  advanceSihangCampaign(state, .1, { friendly: [ai, other], playerSquad: [ai] });
  assert.ok(state.evacuatedIds.includes(ai.id));
  assert.equal(state.counterattack, false, 'a transferred player must not count as an AI crossing');
});

test('a transferred soldier and remaining AI still resolve their original withdrawal wave', () => {
  const state = createSihangCampaign(), player = soldier('taken'), child = soldier('stays-ai'), other = soldier('other'), pending = soldier('pending');
  state.reserve = 0;
  const friendly = [player, child, other, pending];
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
  state.assemblyReleased = true;
  const squads = [[player.id, child.id], [other.id], ...Array.from({ length: 8 }, () => [])];
  const originalAi = [...state.aiRetreatIds];
  assert.throws(() => transferSihangRetreatSquad(state, [player, player]), RangeError);
  assert.deepEqual(state.aiRetreatIds, originalAi);
  const wave = startSihangWithdrawalWave(state, squads);
  transferSihangRetreatSquad(state, [player]);
  player.playerUnit = true;
  player.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player] });
  assert.equal(state.counterattack, false);
  assert.equal(advanceSihangWithdrawalWave(state), 'main');
  child.position.z = 40;
  other.health = 0;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player] });
  assert.equal(state.counterattack, true);
  assert.deepEqual(state.evacuatedIds, [player.id, child.id]);
  assert.deepEqual(state.retreatLostIds, [other.id]);
  assert.deepEqual(wave.squads, squads);
  assert.equal(advanceSihangWithdrawalWave(state), 'refill');
  pending.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player] });
  assert.equal(state.outcome, 'withdrawal-ended');
});

test('all four initial squads consume the same 260-person budget and the final replacement cannot overdraw', () => {
  const state = createSihangCampaign();
  for (let index = 0; index < 4; index++) registerSihangDeployment(state, 11);
  assert.equal(state.reserve, 216); assert.equal(state.deployed, 44);
  while (state.reserve > 0) registerSihangDeployment(state, sihangDeploymentCount(state));
  assert.equal(state.deployed, 260); assert.equal(sihangDeploymentCount(state), 0);
  assert.throws(() => registerSihangDeployment(state, 1), RangeError);
});

test('night withdrawal locks survivors plus reserves and player crossing does not trigger the ground counterattack', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  registerSihangDeployment(state, 11);
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds - 1, { friendly: [player, ai] });
  assert.equal(state.stage, 'sihang-defense');
  advanceSihangCampaign(state, 1, { friendly: [player, ai] });
  assert.equal(state.stage, 'sihang-retreat'); assert.equal(state.stageRemaining, null);
  assert.equal(state.retreatTotal, 251);
  assert.equal(sihangDeploymentCount(state), 11);
  const reserve = state.reserve;
  const replacement = Array.from({ length: 11 }, (_, i) => soldier(`cover-${i}`, true));
  registerSihangDeployment(state, 11, replacement);
  assert.equal(state.reserve, reserve - 11); assert.equal(state.retreatReserve, reserve - 11);
  assert.equal(state.retreatDeployed, 11);
  state.assemblyReleased = true;
  player.position.z = 45;
  advanceSihangCampaign(state, 1, { friendly: [player, ai], playerSquad: [player], player });
  assert.equal(state.outcome, null);
  assert.equal(state.counterattack, false); assert.deepEqual(state.evacuatedIds, ['p']);
  ai.position.z = 40;
  advanceSihangCampaign(state, 1, { friendly: [player, ai], playerSquad: [player], player });
  assert.equal(state.outcome, null); assert.equal(ai.health, 100);
  assert.equal(state.counterattack, true); assert.deepEqual(state.evacuatedIds, ['p', 'ai']);
  const first = state.counterattackAt;
  advanceSihangCampaign(state, 1, { friendly: [player, ai] });
  assert.equal(state.counterattackAt, first);
});

test('crossing before the assembly is released remains reversible and cannot prematurely trigger the counterattack', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  state.reserve = 0;
  const friendly = [player, ai];
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
  player.position.z = ai.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly });
  assert.deepEqual(state.evacuatedIds, []);
  assert.equal(state.counterattack, false); assert.equal(state.outcome, null);
  player.position.z = ai.position.z = -4;
  advanceSihangCampaign(state, .1, { friendly });
  state.assemblyReleased = true;
  player.position.z = ai.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly });
  assert.deepEqual(state.evacuatedIds, ['p', 'ai']);
  assert.equal(state.counterattack, true);
  assert.equal(state.outcome, 'withdrawal-ended');
});

test('returning a living AI to reserve preserves the troop budget and does not count it as killed or evacuated', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  registerSihangDeployment(state, 2);
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [player, ai] });
  const before = sihangRetreatStatus(state);
  assert.throws(() => returnSihangRetreatSquadToReserve(state, [ai, ai]), RangeError);
  assert.throws(() => returnSihangRetreatSquadToReserve(state, [player]), RangeError);
  returnSihangRetreatSquadToReserve(state, [ai]);
  assert.equal(state.reserve, 259);
  assert.equal(state.retreatReserve, 259);
  assert.equal(state.deployed, 1);
  assert.equal(sihangRetreatStatus(state).total, before.total);
  assert.equal(sihangRetreatStatus(state).casualties, before.casualties);
  assert.equal(sihangRetreatStatus(state).saved, 0);
  assert.equal(sihangRetreatStatus(state).unresolved, before.unresolved);
  assert.throws(() => returnSihangRetreatSquadToReserve(state, [ai]), RangeError);
  const replacement = soldier('replacement');
  registerSihangRetreatSquad(state, [replacement]);
  advanceSihangCampaign(state, .1, { friendly: [player, replacement] });
  assert.deepEqual(state.retreatLostIds, []);
  assert.equal(state.reserve, 258);
  assert.equal(state.deployed, 2);
});

test('AI withdrawal requires release but does not wait for nightfall', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  const squads = [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h'], ['i'], ['j']];
  assert.throws(() => startSihangWithdrawalWave(state, squads), RangeError);
  state.assemblyReleased = true;
  assert.equal(startSihangWithdrawalWave(state, squads).phase, 'main');
});

test('withdrawal batches retain ten squad slots but cap the selected group at 50 distinct soldiers', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true; state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  const squads = Array.from({ length: 10 }, (_, squad) =>
    Array.from({ length: 11 }, (_, member) => `soldier-${squad}-${member}`));
  const batch = sihangWithdrawalBatch(squads);
  assert.equal(batch.length, SIHANG_RULES.retreatSquads);
  assert.equal(batch.flat().length, SIHANG_RULES.retreatWaveLimit);
  assert.equal(new Set(batch.flat()).size, SIHANG_RULES.retreatWaveLimit);
  assert.throws(() => startSihangWithdrawalWave(state, squads), RangeError);
  assert.throws(() => sihangWithdrawalBatch(squads, 51), RangeError);
  assert.throws(() => sihangWithdrawalBatch(squads.slice(0, 5)), RangeError);
  const wave = startSihangWithdrawalWave(state, batch);
  assert.equal(wave.squads.flat().length, SIHANG_RULES.retreatWaveLimit);
});

test('successive ten-squad waves preserve the finite reserve and release the final partial wave', () => {
  const state = createSihangCampaign();
  state.reserve = 209; state.deployed = 51;
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true; state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  let serial = 0;
  const sizes = [];
  while (state.retreatReserve) {
    let remaining = SIHANG_RULES.retreatWaveLimit;
    const squads = Array.from({ length: 10 }, () => {
      const count = Math.min(remaining, SIHANG_RULES.squadMembers, sihangRetreatDeploymentCount(state));
      if (!count) return [];
      const members = Array.from({ length: count }, () => soldier(`wave-${serial++}`));
      registerSihangRetreatSquad(state, members);
      remaining -= count;
      return members.map(member => member.id);
    });
    const wave = startSihangWithdrawalWave(state, squads);
    sizes.push(wave.squads.flat().length);
    state.evacuatedIds.push(...wave.squads.flat());
    assert.equal(advanceSihangWithdrawalWave(state), 'refill');
  }
  assert.deepEqual(sizes, [50, 50, 50, 50, 9]);
  assert.equal(new Set(state.aiRetreatIds).size, 209);
  assert.equal(state.reserve, 0);
  assert.equal(state.deployed, 260);
});

test('later-wave assembly countdown follows simulation time independently of nightfall', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  assert.equal(sihangWaveAssemblyRemaining(state), null);
  state.waveAssemblyAt = state.elapsed;
  assert.equal(sihangWaveAssemblyRemaining(state), SIHANG_RULES.assemblyTimeout);
  state.elapsed += 5; state.stageElapsed += 5;
  assert.equal(sihangWaveAssemblyRemaining(state), SIHANG_RULES.assemblyTimeout - 5);
  state.elapsed -= 5; state.stageElapsed -= 5;
  state.elapsed += SIHANG_RULES.assemblyTimeout - .1;
  state.stageElapsed += SIHANG_RULES.assemblyTimeout - .1;
  assert.ok(Math.abs(sihangWaveAssemblyRemaining(state) - .1) < 1e-8);
  state.elapsed += .1; state.stageElapsed += .1;
  assert.equal(sihangWaveAssemblyRemaining(state), 0);
  state.waveAssemblyAt = state.elapsed;
  assert.equal(sihangWaveAssemblyRemaining(state), SIHANG_RULES.assemblyTimeout);
});

test('a wave waits for the other squads and covering squad, then releases the next batch immediately', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true;
  const squads = [['a1', 'a2'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h'], ['i'], ['j']];
  const wave = startSihangWithdrawalWave(state, squads);
  assert.equal(wave.coverSlot, 0);
  wave.covering = true;
  state.evacuatedIds.push('b', 'c', 'd', 'f', 'g', 'h', 'i', 'j');
  assert.equal(advanceSihangWithdrawalWave(state), 'main');
  state.retreatLostIds.push('e');
  assert.equal(advanceSihangWithdrawalWave(state), 'cover');
  state.evacuatedIds.push('a1');
  assert.equal(advanceSihangWithdrawalWave(state), 'cover');
  state.retreatLostIds.push('a2');
  assert.equal(advanceSihangWithdrawalWave(state), 'refill');
  assert.equal(state.withdrawalWave, null);
  const next = startSihangWithdrawalWave(state, [[], ['partial'], [], [], [], [], [], [], [], []]);
  assert.equal(next.number, 2);
  assert.equal(next.coverSlot, 1);
  next.covering = true;
  assert.equal(advanceSihangWithdrawalWave(state), 'cover');
});

test('without an attack the entire wave departs before the next-wave interval begins', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true; state.stageElapsed = 20;
  const wave = startSihangWithdrawalWave(state, [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h'], ['i'], ['j']]);
  state.evacuatedIds.push('b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
  assert.equal(advanceSihangWithdrawalWave(state), 'main');
  assert.equal(wave.covering, false);
  state.evacuatedIds.push('a');
  assert.equal(advanceSihangWithdrawalWave(state), 'refill');
});

test('majority does not end the mission; the final identity ends it without waiting for parade walking', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai'), survivor = soldier('s', true);
  state.reserve = 0;
  const others = [soldier('b'), soldier('c')], friendly = [player, survivor, ai, ...others];
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
  state.assemblyReleased = true;
  player.position.z = ai.position.z = others[0].position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player, survivor], player });
  assert.equal(state.outcome, null);
  assert.equal(sihangDeploymentCount(state), 0);
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player, survivor], player });
  assert.equal(state.outcome, null);
  assert.equal(state.retreatTotal, 5);
  survivor.position.z = 40;
  others[1].health = 0;
  advanceSihangCampaign(state, .1, { friendly });
  assert.equal(state.outcome, 'withdrawal-ended');
});

test('a stationary northern AI prompts the player after 15 seconds and the player must reach the south bank', () => {
  const state = createSihangCampaign(), player = soldier('p', true), rescued = soldier('rescued'), stuck = soldier('stuck');
  state.reserve = 0;
  const friendly = [player, rescued, stuck];
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
  state.assemblyReleased = true;
  rescued.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, player });
  advanceSihangCampaign(state, 14.9, { friendly, player });
  assert.equal(state.finalRetreatOrdered, false);
  advanceSihangCampaign(state, 0, { friendly, player });
  assert.equal(state.finalRetreatOrdered, false);
  stuck.position.x += .6;
  advanceSihangCampaign(state, .1, { friendly, player });
  advanceSihangCampaign(state, 15, { friendly, player });
  assert.equal(state.finalRetreatOrdered, true);
  stuck.position.x += 1;
  advanceSihangCampaign(state, 100, { friendly, player });
  assert.equal(state.finalRetreatOrdered, true, 'the final order remains active after the soldier moves');
  assert.equal(state.outcome, null);
  player.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, player });
  assert.equal(state.outcome, 'withdrawal-ended');
  assert.equal(stuck.health, 100);
  assert.deepEqual(state.retreatLostIds, []);
  assert.equal(sihangRetreatStatus(state).unresolved, 1);
});

test('a player can return north after reaching the evacuation bank and rejoin the unresolved retreat', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  state.stage = 'sihang-retreat';
  state.assemblyReleased = true;
  state.retreatIds = ['p', 'ai'];
  state.evacuatedIds = ['p'];
  state.retreatTotal = 2;
  player.position.z = 40;
  player.sihangEvacuated = true;
  player.position.z = -5;

  assert.equal(reopenSihangPlayerEvacuation(state, player), true);
  assert.equal(player.sihangEvacuated, false);
  assert.deepEqual(state.evacuatedIds, []);
  advanceSihangCampaign(state, .1, { friendly: [player, ai], player });
  assert.equal(state.outcome, null);
  assert.equal(sihangRetreatStatus(state).unresolved, 2);

  player.position.z = 40;
  player.sihangEvacuated = true;
  state.evacuatedIds.push(player.id);
  assert.equal(reopenSihangPlayerEvacuation(state, player), false, 'a player still on the south bank stays evacuated');
  state.outcome = 'withdrawal-ended';
  player.position.z = -5;
  assert.equal(reopenSihangPlayerEvacuation(state, player), false, 'terminal outcomes remain terminal');
});

test('the last player receives the order, while a soldier still crossing is not treated as stranded', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  state.reserve = 0;
  const friendly = [player, ai];
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
  state.assemblyReleased = true;
  ai.position.z = 40;
  advanceSihangCampaign(state, 100, { friendly, player });
  assert.equal(state.outcome, null);
  assert.equal(state.finalRetreatOrdered, true);
  player.position.z = 40;
  ai.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, player });
  assert.equal(state.outcome, 'withdrawal-ended');

  const crossing = createSihangCampaign(), p = soldier('p', true), onBridge = soldier('bridge');
  crossing.reserve = 0;
  advanceSihangCampaign(crossing, SIHANG_RULES.defenseSeconds, { friendly: [p, onBridge] });
  crossing.assemblyReleased = true; p.position.z = 40;
  onBridge.position = { x: 83, y: 1.15, z: -22 };
  advanceSihangCampaign(crossing, 100, { friendly: [p, onBridge], player: p });
  advanceSihangCampaign(crossing, 100, { friendly: [p, onBridge], player: p });
  assert.equal(crossing.outcome, null);
  assert.equal(crossing.finalRetreatOrdered, false);
});

test('only up to ten stranded soldiers prompt final retreat; reinforcements prevent it', () => {
  for (const count of [10, 11]) {
    const state = createSihangCampaign(), player = soldier('p', true);
    const group = Array.from({ length: count }, (_, i) => soldier(`ai-${i}`));
    state.reserve = 0;
    const friendly = [player, ...group];
    advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
    state.assemblyReleased = true; player.position.z = 40;
    advanceSihangCampaign(state, .1, { friendly, player });
    advanceSihangCampaign(state, 15, { friendly, player });
    assert.equal(state.finalRetreatOrdered, count <= 10);
    assert.equal(state.outcome, count <= 10 ? 'withdrawal-ended' : null);
  }

  const reserve = createSihangCampaign(), player = soldier('p', true), other = soldier('other');
  player.position.z = 40;
  reserve.reserve = 1;
  advanceSihangCampaign(reserve, SIHANG_RULES.defenseSeconds, { friendly: [player, other] });
  reserve.assemblyReleased = true;
  advanceSihangCampaign(reserve, 100, { friendly: [player, other], player });
  advanceSihangCampaign(reserve, 100, { friendly: [player, other], player });
  assert.equal(reserve.finalRetreatOrdered, false);
  assert.equal(reserve.outcome, null);
});

test('repeated movement near one point is not mistaken for being stationary', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  state.reserve = 0;
  const friendly = [player, ai];
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly });
  state.assemblyReleased = true; player.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, player });
  for (let i = 0; i < 10; i++) {
    ai.position.x = 48 + (i % 2 ? 0 : .3);
    advanceSihangCampaign(state, 10, { friendly, player });
  }
  assert.equal(state.finalRetreatOrdered, false);
  assert.equal(state.outcome, null);
});

test('withdrawal with heavy losses ends normally once all fates are known', () => {
  const state = createSihangCampaign(), original = soldier('original', true), next = soldier('next', true), ai = soldier('ai');
  state.reserve = 0;
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [original, next, ai] });
  state.assemblyReleased = true;
  original.health = ai.health = 0;
  advanceSihangCampaign(state, 100000, { friendly: [original, next, ai] });
  assert.equal(state.outcome, null); assert.equal(state.stageRemaining, null);
  next.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly: [original, next, ai], playerSquad: [original, next], player: next });
  assert.equal(state.outcome, 'withdrawal-ended');
  assert.equal(state.evacuatedIds.length, 1);
});

test('finite waves release every remaining identity and never recycle saved or dead soldiers', () => {
  const state = createSihangCampaign(), player = soldier('p', true);
  state.reserve = 209; state.deployed = 51;
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [player] });
  state.assemblyReleased = true;
  player.position.z = 40;
  let serial = 0;
  while (state.retreatReserve) {
    const count = sihangRetreatDeploymentCount(state);
    const wave = Array.from({ length: count }, () => soldier(`wave-${serial++}`, false, 40));
    registerSihangRetreatSquad(state, wave);
    assert.throws(() => registerSihangRetreatSquad(state, wave), RangeError);
    advanceSihangCampaign(state, .1, { friendly: [player, ...wave] });
  }
  assert.equal(serial, 209); assert.equal(state.reserve, 0); assert.equal(state.deployed, 260);
  assert.equal(state.aiRetreatIds.length, 209); assert.equal(state.evacuatedIds.length, 210);
  const status = sihangRetreatStatus(state);
  assert.equal(status.casualties, 50); assert.equal(status.saved + status.casualties + status.unresolved, 260);
  assert.equal(sihangRetreatDeploymentCount(state), 0);
  assert.equal(state.outcome, 'withdrawal-ended');
  assert.equal(sihangRetreatStatus(state).saved, state.retreatTotal);
});

test('installation, 25-second fuse and four-second defuse are independent; a short interruption preserves shared progress', () => {
  const state = createSihangCampaign();
  assert.equal(advanceSihangDemolition(state, 5, { operatorId: 'engineer' }), 'installing');
  advanceSihangDemolition(state, 0, { operatorId: 'engineer' });
  assert.equal(state.demolition.installProgress, 5);
  advanceSihangDemolition(state, 1, {});
  assert.equal(state.demolition.installProgress, 0);
  assert.equal(advanceSihangDemolition(state, 10, { operatorId: 'replacement' }), 'armed');
  advanceSihangDemolition(state, 4, {});
  assert.equal(state.demolition.fuseRemaining, 21);
  advanceSihangDemolition(state, 2, { defusing: true, defuserId: 'p' });
  assert.equal(state.demolition.fuseRemaining, 21);
  advanceSihangDemolition(state, 1, {});
  assert.equal(state.demolition.defuseProgress, 2); assert.equal(state.demolition.fuseRemaining, 20);
  assert.equal(advanceSihangDemolition(state, 2, { defusing: true, defuserId: 'squadmate' }), 'disarmed');
  assert.equal(state.demolition.disarmed, 1); assert.equal(state.outcome, null);
  assert.equal(state.demolition.cooldownUntil, 35);
  assert.equal(advanceSihangDemolition(state, 10, { operatorId: 'engineer' }), null);
  state.elapsed = 35;
  assert.equal(advanceSihangDemolition(state, 10, { operatorId: 'engineer' }), 'armed');
  advanceSihangDemolition(state, 2, { defusing: true, defuserId: 'p' });
  advanceSihangDemolition(state, 3, {});
  assert.equal(state.demolition.defuseProgress, 0, 'leaving it unattended beyond the grace period still loses progress');
});

test('an installed charge survives its installer and is no longer a defense objective after the withdrawal order', () => {
  const state = createSihangCampaign();
  advanceSihangDemolition(state, 10, { operatorId: 'engineer' });
  assert.equal(advanceSihangDemolition(state, 25, {}), 'detonated');
  assert.equal(state.outcome, null); assert.equal(state.northWallBreached, true);
  assert.equal(advanceSihangDemolition(state, 30, { operatorId: 'engineer' }), null, 'the open breach cannot be repeatedly demolished');
  advanceSihangCampaign(state, 1, { friendly: [soldier('p', true)] });
  assert.equal(state.stage, 'sihang-defense'); assert.equal(state.outcome, null);
  const withdrawing = createSihangCampaign(), player = soldier('p', true);
  advanceSihangDemolition(withdrawing, 10, { operatorId: 'engineer' });
  advanceSihangCampaign(withdrawing, SIHANG_RULES.defenseSeconds, { friendly: [player] });
  advanceSihangDemolition(withdrawing, 30, {});
  assert.equal(withdrawing.outcome, null);
  assert.equal(sihangEnemyMayAttack({ x: 48, z: 34 }), false);
  assert.equal(sihangEnemyMayAttack({ x: 0, z: 31 }), true);
  assert.equal(sihangSafePosition({ x: 48, z: 40, y: 0 }), true, 'a survivor in a south-bank house is already in the concession');
});

test('occupation and exhausted forces are terminal and cannot flip after later events', () => {
  for (const reason of ['occupied', 'exhausted']) {
    const state = createSihangCampaign(), player = soldier('p', true);
    if (reason === 'occupied') advanceSihangCampaign(state, 1, { friendly: [player], captureLost: true });
    if (reason === 'exhausted') { state.reserve = 0; advanceSihangCampaign(state, 1, {}); }
    assert.equal(state.outcome, reason);
    player.position.z = 40;
    advanceSihangCampaign(state, 1, { friendly: [player], playerSquad: [player], player });
    assert.equal(state.outcome, reason);
  }
});
