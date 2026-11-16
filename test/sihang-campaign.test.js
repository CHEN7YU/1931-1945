import test from 'node:test';
import assert from 'node:assert/strict';
import { createSihangCampaign, SIHANG_RULES, sihangDeploymentCount, registerSihangDeployment,
  advanceSihangCampaign, advanceSihangDemolition, sihangSafePosition, sihangEnemyMayAttack,
  sihangRetreatDeploymentCount, registerSihangRetreatSquad, sihangRetreatStatus,
  returnSihangRetreatSquadToReserve, transferSihangRetreatSquad,
  startSihangWithdrawalWave, advanceSihangWithdrawalWave, sihangWaveAssemblyRemaining } from '../src/sihang-campaign.js';

const soldier = (id, playerUnit = false, z = -25) => ({ id, playerUnit, health: 100, position: { x: 48, y: 0, z } });

test('taking over existing AI preserves the troop budget and original withdrawal identities', () => {
  const state = createSihangCampaign(), ai = soldier('ai'), other = soldier('other');
  registerSihangDeployment(state, 11);
  advanceSihangCampaign(state, 240, { friendly: [ai, other] });
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
  const state = createSihangCampaign(), player = soldier('taken'), child = soldier('stays-ai'), other = soldier('other');
  state.reserve = 0;
  const friendly = [player, child, other];
  advanceSihangCampaign(state, 240, { friendly });
  state.assemblyReleased = true;
  const squads = [[player.id, child.id], [other.id], ...Array.from({ length: 8 }, () => [])];
  const wave = startSihangWithdrawalWave(state, squads);
  transferSihangRetreatSquad(state, [player]);
  player.playerUnit = true;
  player.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player] });
  assert.equal(state.counterattack, false);
  assert.equal(advanceSihangWithdrawalWave(state), 'main');
  child.position.z = 40;
  other.health = 0;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player], settling: 1 });
  assert.equal(state.counterattack, true);
  assert.deepEqual(state.evacuatedIds, [player.id, child.id]);
  assert.deepEqual(state.retreatLostIds, [other.id]);
  assert.deepEqual(wave.squads, squads);
  assert.equal(advanceSihangWithdrawalWave(state), 'interval');
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player] });
  assert.equal(state.outcome, 'evacuated');
});

test('all four initial squads consume the same 400-person budget and the final replacement cannot overdraw', () => {
  const state = createSihangCampaign();
  for (let index = 0; index < 4; index++) registerSihangDeployment(state, 11);
  assert.equal(state.reserve, 356); assert.equal(state.deployed, 44);
  while (state.reserve > 0) registerSihangDeployment(state, sihangDeploymentCount(state));
  assert.equal(state.deployed, 400); assert.equal(sihangDeploymentCount(state), 0);
  assert.throws(() => registerSihangDeployment(state, 1), RangeError);
});

test('night withdrawal locks survivors plus reserves and player crossing does not trigger the ground counterattack', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  registerSihangDeployment(state, 11);
  advanceSihangCampaign(state, 239, { friendly: [player, ai] });
  assert.equal(state.stage, 'sihang-defense');
  advanceSihangCampaign(state, 1, { friendly: [player, ai] });
  assert.equal(state.stage, 'sihang-retreat'); assert.equal(state.stageRemaining, null);
  assert.equal(state.retreatTotal, 391); assert.equal(state.retreatRequired, 196);
  assert.equal(sihangDeploymentCount(state), 11);
  const reserve = state.reserve;
  const replacement = Array.from({ length: 11 }, (_, i) => soldier(`cover-${i}`, true));
  registerSihangDeployment(state, 11, replacement);
  assert.equal(state.reserve, reserve - 11); assert.equal(state.retreatReserve, reserve - 11);
  assert.equal(state.retreatDeployed, 11);
  state.assemblyReleased = true;
  player.position.z = 45;
  advanceSihangCampaign(state, 1, { friendly: [player, ai], playerSquad: [player], player });
  assert.equal(state.outcome, null); assert.equal(state.playerRetreatOpen, false);
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
  advanceSihangCampaign(state, 240, { friendly });
  player.position.z = ai.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly });
  assert.deepEqual(state.evacuatedIds, []);
  assert.equal(state.counterattack, false); assert.equal(state.outcome, null);
  player.position.z = ai.position.z = -4;
  advanceSihangCampaign(state, .1, { friendly });
  state.assemblyReleased = true;
  player.position.z = ai.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, settling: 1 });
  assert.deepEqual(state.evacuatedIds, ['p', 'ai']);
  assert.equal(state.counterattack, true); assert.equal(state.outcome, null);
  advanceSihangCampaign(state, .1, { friendly });
  assert.equal(state.outcome, 'evacuated');
});

test('returning a living AI to reserve preserves the troop budget and does not count it as killed or evacuated', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai');
  registerSihangDeployment(state, 2);
  advanceSihangCampaign(state, 240, { friendly: [player, ai] });
  const before = sihangRetreatStatus(state);
  assert.throws(() => returnSihangRetreatSquadToReserve(state, [ai, ai]), RangeError);
  assert.throws(() => returnSihangRetreatSquadToReserve(state, [player]), RangeError);
  returnSihangRetreatSquadToReserve(state, [ai]);
  assert.equal(state.reserve, 399);
  assert.equal(state.retreatReserve, 399);
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
  assert.equal(state.reserve, 398);
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

test('a full withdrawal wave holds ten original squads and 110 distinct soldiers', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true; state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  const squads = Array.from({ length: 10 }, (_, squad) =>
    Array.from({ length: 11 }, (_, member) => `soldier-${squad}-${member}`));
  assert.throws(() => startSihangWithdrawalWave(state, squads.slice(0, 5)), RangeError);
  const wave = startSihangWithdrawalWave(state, squads);
  assert.equal(wave.squads.flat().length, 110);
  assert.equal(new Set(wave.squads.flat()).size, 110);
});

test('successive ten-squad waves preserve the finite reserve and release the final partial wave', () => {
  const state = createSihangCampaign();
  state.reserve = 349; state.deployed = 51;
  advanceSihangCampaign(state, SIHANG_RULES.defenseSeconds, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true; state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  let serial = 0;
  const sizes = [];
  while (state.retreatReserve) {
    const squads = Array.from({ length: 10 }, () => {
      const count = sihangRetreatDeploymentCount(state);
      if (!count) return [];
      const members = Array.from({ length: count }, () => soldier(`wave-${serial++}`));
      registerSihangRetreatSquad(state, members);
      return members.map(member => member.id);
    });
    const wave = startSihangWithdrawalWave(state, squads);
    sizes.push(wave.squads.flat().length);
    state.evacuatedIds.push(...wave.squads.flat());
    assert.equal(advanceSihangWithdrawalWave(state), 'interval');
    state.elapsed += SIHANG_RULES.waveInterval;
    assert.equal(advanceSihangWithdrawalWave(state), 'refill');
  }
  assert.deepEqual(sizes, [110, 110, 110, 19]);
  assert.equal(new Set(state.aiRetreatIds).size, 349);
  assert.equal(state.reserve, 0);
  assert.equal(state.deployed, 400);
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

test('a wave waits for the other squads, then the covering squad, then five simulation seconds', () => {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, 240, { friendly: [soldier('p', true)] });
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
  assert.equal(advanceSihangWithdrawalWave(state), 'interval');
  state.elapsed += 4.99;
  assert.equal(advanceSihangWithdrawalWave(state), 'interval');
  state.elapsed += .01;
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
  advanceSihangCampaign(state, 240, { friendly: [soldier('p', true)] });
  state.assemblyReleased = true; state.stageElapsed = 20;
  const wave = startSihangWithdrawalWave(state, [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h'], ['i'], ['j']]);
  state.evacuatedIds.push('b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
  assert.equal(advanceSihangWithdrawalWave(state), 'main');
  assert.equal(wave.covering, false);
  state.evacuatedIds.push('a');
  assert.equal(advanceSihangWithdrawalWave(state), 'interval');
});

test('majority does not end the mission; the final identity and its physical parade walk must both be resolved', () => {
  const state = createSihangCampaign(), player = soldier('p', true), ai = soldier('ai'), survivor = soldier('s', true);
  state.reserve = 0;
  const others = [soldier('b'), soldier('c')], friendly = [player, survivor, ai, ...others];
  advanceSihangCampaign(state, 240, { friendly });
  state.assemblyReleased = true;
  player.position.z = ai.position.z = others[0].position.z = 40;
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player, survivor], player });
  assert.equal(state.playerRetreatOpen, true);
  assert.equal(state.outcome, null);
  assert.equal(sihangDeploymentCount(state), 0);
  advanceSihangCampaign(state, .1, { friendly, playerSquad: [player, survivor], player });
  assert.equal(state.outcome, null);
  assert.equal(state.retreatTotal, 5); assert.equal(state.retreatRequired, 3);
  survivor.position.z = 40;
  others[1].health = 0;
  advanceSihangCampaign(state, .1, { friendly, settling: 1 });
  assert.equal(state.outcome, null);
  advanceSihangCampaign(state, .1, { friendly, settling: 0 });
  assert.equal(state.outcome, 'evacuated');
});

test('losses never lower the required majority and even a doomed evacuation continues until all fates are known', () => {
  const state = createSihangCampaign(), original = soldier('original', true), next = soldier('next', true), ai = soldier('ai');
  state.reserve = 0;
  advanceSihangCampaign(state, 240, { friendly: [original, next, ai] });
  state.assemblyReleased = true;
  original.health = ai.health = 0;
  advanceSihangCampaign(state, 100000, { friendly: [original, next, ai] });
  assert.equal(state.outcome, null); assert.equal(state.stageRemaining, null);
  next.position.z = 40;
  advanceSihangCampaign(state, .1, { friendly: [original, next, ai], playerSquad: [original, next], player: next });
  assert.equal(state.outcome, 'retreat-losses');
  assert.equal(state.retreatRequired, 2); assert.equal(state.evacuatedIds.length, 1);
});

test('finite waves release exactly 350 identities, including the final partial squad, and never recycle saved or dead soldiers', () => {
  const state = createSihangCampaign(), player = soldier('p', true);
  state.reserve = 349; state.deployed = 51;
  advanceSihangCampaign(state, 240, { friendly: [player] });
  state.assemblyReleased = true;
  assert.equal(state.retreatRequired, 176);
  player.position.z = 40;
  let serial = 0;
  while (state.retreatReserve) {
    const count = sihangRetreatDeploymentCount(state);
    const wave = Array.from({ length: count }, () => soldier(`wave-${serial++}`, false, 40));
    registerSihangRetreatSquad(state, wave);
    assert.throws(() => registerSihangRetreatSquad(state, wave), RangeError);
    advanceSihangCampaign(state, .1, { friendly: [player, ...wave] });
  }
  assert.equal(serial, 349); assert.equal(state.reserve, 0); assert.equal(state.deployed, 400);
  assert.equal(state.aiRetreatIds.length, 349); assert.equal(state.evacuatedIds.length, 350);
  const status = sihangRetreatStatus(state);
  assert.equal(status.casualties, 50); assert.equal(status.saved + status.casualties + status.unresolved, 400);
  assert.equal(sihangRetreatDeploymentCount(state), 0);
  assert.equal(state.outcome, 'evacuated'); assert.equal(sihangRetreatStatus(state).grade, '全员撤离');
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
  advanceSihangCampaign(withdrawing, 240, { friendly: [player] });
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
