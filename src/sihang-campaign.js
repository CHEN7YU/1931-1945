import { sihangNorthBank, sihangSouthBank } from './sihang-layout.js';

export const SIHANG_RULES = Object.freeze({
  defenseSeconds: 240, troopLimit: 400, squadMembers: 11,
  retreatSquads: 10, waveInterval: 5, retreatSpawnInterval: 2, assemblyTimeout: 30, coverRespawnSeconds: 10,
  strandedLimit: 3, strandedStillSeconds: 30, strandedCountdownSeconds: 30,
  flareSeconds: 24, flareInterval: 34, nightfallSeconds: 20,
  demolitionMembers: 20, installSeconds: 10, fuseSeconds: 25, defuseSeconds: 4,
  defuseGraceSeconds: 3, demolitionCooldownSeconds: 35,
});

export function createSihangCampaign() {
  return {
    stage: 'sihang-defense', stageElapsed: 0, stageRemaining: SIHANG_RULES.defenseSeconds,
    elapsed: 0, reserve: SIHANG_RULES.troopLimit, deployed: 0, retreatDeployed: 0, outcome: null,
    retreatIds: [], aiRetreatIds: [], evacuatedIds: [], playerRetreatOpen: false, warnings: [], northWallBreached: false,
    retreatTotal: 0, retreatRequired: 0, retreatReserve: 0, retreatLostIds: [],
    counterattack: false, counterattackAt: null, assemblyPrepared: false, assemblyReleased: false, coverRespawnAt: 0,
    withdrawalWave: null, withdrawalWaveNumber: 0, waveAssemblyAt: null, retreatNextSpawnAt: 0, retreatNextSpawnSlot: 0,
    strandedWatch: null, strandedCountdownAt: null,
    demolition: { state: 'idle', operatorId: null, installProgress: 0,
      fuseRemaining: SIHANG_RULES.fuseSeconds, defuseProgress: 0, defuserId: null, defuseInterruptedFor: 0,
      cooldownUntil: 0, installations: 0, disarmed: 0 },
  };
}

export function sihangWaveAssemblyRemaining(campaign) {
  if (campaign.stage !== 'sihang-retreat' || campaign.waveAssemblyAt === null) return null;
  return Math.max(0, campaign.waveAssemblyAt + SIHANG_RULES.assemblyTimeout - campaign.elapsed);
}

export function startSihangWithdrawalWave(campaign, squads) {
  if (campaign.stage !== 'sihang-retreat' || campaign.outcome || !campaign.assemblyReleased ||
    campaign.withdrawalWave ||
    !Array.isArray(squads) || squads.length !== SIHANG_RULES.retreatSquads ||
    squads.some(squad => !Array.isArray(squad) || squad.some(id => typeof id !== 'string')) ||
    new Set(squads.flat()).size !== squads.flat().length || !squads.some(squad => squad.length))
    throw new RangeError('Invalid Sihang withdrawal wave');
  const coverSlot = squads.findIndex(squad => squad.length);
  campaign.withdrawalWave = { number: ++campaign.withdrawalWaveNumber, phase: 'main', coverSlot, covering: false,
    squads: squads.map(squad => [...squad]), completedAt: null };
  return campaign.withdrawalWave;
}

export function advanceSihangWithdrawalWave(campaign) {
  const wave = campaign.withdrawalWave;
  if (!wave || campaign.outcome) return null;
  const resolved = new Set([...campaign.evacuatedIds, ...campaign.retreatLostIds]);
  const completed = ids => ids.every(id => resolved.has(id));
  if (wave.phase === 'main' && wave.covering &&
    wave.squads.every((ids, slot) => slot === wave.coverSlot || completed(ids))) wave.phase = 'cover';
  if (wave.phase === 'main' && !wave.covering && wave.squads.every(completed)) {
    wave.phase = 'interval';
    wave.completedAt = campaign.elapsed;
  }
  if (wave.phase === 'cover' && completed(wave.squads[wave.coverSlot])) {
    wave.phase = 'interval';
    wave.completedAt = campaign.elapsed;
  }
  if (wave.phase === 'interval' && campaign.elapsed >= wave.completedAt + SIHANG_RULES.waveInterval) {
    campaign.withdrawalWave = null;
    return 'refill';
  }
  return wave.phase;
}

export function sihangDeploymentCount(campaign, requested = SIHANG_RULES.squadMembers) {
  if (!Number.isInteger(requested) || requested < 1 || requested > SIHANG_RULES.squadMembers)
    throw new RangeError('Invalid Sihang replacement squad size');
  if (campaign.outcome) return 0;
  return ['sihang-defense', 'sihang-retreat'].includes(campaign.stage) ? Math.min(requested, campaign.reserve) : 0;
}

export function sihangRetreatDeploymentCount(campaign, requested = SIHANG_RULES.squadMembers) {
  if (!Number.isInteger(requested) || requested < 1 || requested > SIHANG_RULES.squadMembers)
    throw new RangeError('Invalid retreat squad size');
  return campaign.stage === 'sihang-retreat' && !campaign.outcome ? Math.min(requested, campaign.retreatReserve) : 0;
}

export function returnSihangRetreatSquadToReserve(campaign, actors) {
  if (campaign.stage !== 'sihang-retreat' || campaign.outcome || !Array.isArray(actors) ||
    new Set(actors.map(actor => actor?.id)).size !== actors.length ||
    actors.some(actor => !actor?.id || actor.playerUnit || actor.health <= 0 ||
      !campaign.aiRetreatIds.includes(actor.id) || !campaign.retreatIds.includes(actor.id) ||
      campaign.evacuatedIds.includes(actor.id) || campaign.retreatLostIds.includes(actor.id)) ||
    campaign.deployed < actors.length)
    throw new RangeError('Only active living AI retreat soldiers can return to reserve');
  const returned = new Set(actors.map(actor => actor.id));
  campaign.retreatIds = campaign.retreatIds.filter(id => !returned.has(id));
  campaign.aiRetreatIds = campaign.aiRetreatIds.filter(id => !returned.has(id));
  campaign.reserve += actors.length;
  campaign.retreatReserve += actors.length;
  campaign.deployed -= actors.length;
}

export function registerSihangRetreatSquad(campaign, actors) {
  const count = sihangRetreatDeploymentCount(campaign);
  if (!Array.isArray(actors) || !actors.length || actors.length > count ||
    actors.some(actor => !actor.id || actor.playerUnit || actor.health <= 0 ||
      campaign.retreatIds.includes(actor.id)) || new Set(actors.map(actor => actor.id)).size !== actors.length)
    throw new RangeError('Retreat waves require new living original AI soldiers within the remaining budget');
  campaign.retreatReserve -= actors.length;
  campaign.reserve -= actors.length; campaign.deployed += actors.length;
  campaign.aiRetreatIds.push(...actors.map(actor => actor.id));
  campaign.retreatIds.push(...actors.map(actor => actor.id));
}

export function transferSihangRetreatSquad(campaign, actors) {
  if (campaign.stage !== 'sihang-retreat' || campaign.outcome || !Array.isArray(actors) || !actors.length ||
    new Set(actors.map(actor => actor.id)).size !== actors.length ||
    actors.some(actor => actor.playerUnit || actor.health <= 0 ||
      !campaign.aiRetreatIds.includes(actor.id) || !campaign.retreatIds.includes(actor.id) ||
      campaign.evacuatedIds.includes(actor.id) || campaign.retreatLostIds.includes(actor.id)))
    throw new RangeError('Only active living AI retreat soldiers can be transferred to the player');
  const ids = new Set(actors.map(actor => actor.id));
  campaign.aiRetreatIds = campaign.aiRetreatIds.filter(id => !ids.has(id));
}

export function sihangRetreatStatus(campaign) {
  const saved = campaign.evacuatedIds.length, lost = campaign.retreatLostIds.length;
  return { total: campaign.retreatTotal, required: campaign.retreatRequired, saved, lost,
    waiting: campaign.retreatReserve, active: campaign.retreatTotal - saved - lost - campaign.retreatReserve,
    possible: campaign.retreatTotal - lost, casualties: SIHANG_RULES.troopLimit - campaign.retreatTotal + lost,
    unresolved: campaign.retreatTotal - saved - lost,
    grade: campaign.retreatTotal > 0 && saved === campaign.retreatTotal ? '全员撤离' : saved >= Math.ceil(campaign.retreatTotal * .75)
      ? '出色掩护' : saved >= campaign.retreatRequired ? '完成任务' : '未达目标' };
}

export function registerSihangDeployment(campaign, count, actors = []) {
  if (!Number.isInteger(count) || count < 1 || count > sihangDeploymentCount(campaign))
    throw new RangeError('Sihang deployment exceeds its remaining troop budget');
  if (campaign.stage === 'sihang-retreat') {
    if (actors.length !== count || actors.some(actor => !actor.id || !actor.playerUnit || actor.health <= 0 ||
      campaign.retreatIds.includes(actor.id)) || new Set(actors.map(actor => actor.id)).size !== count)
      throw new RangeError('Cover replacements require new living player-squad identities');
    campaign.retreatDeployed += count; campaign.retreatReserve -= count;
    campaign.retreatIds.push(...actors.map(actor => actor.id));
  }
  campaign.reserve -= count; campaign.deployed += count;
}

export function sihangSafePosition(position) {
  return Boolean(position && Number.isFinite(position.y) && position.y >= -.25 && sihangSouthBank(position, 4));
}

export function sihangEnemyMayAttack(position) {
  return Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.z) && !sihangSouthBank(position));
}

export function advanceSihangDemolition(campaign, dt, { operatorId = null, defusing = false, defuserId = null } = {}) {
  if (!Number.isFinite(dt) || dt < 0 || typeof defusing !== 'boolean' ||
    operatorId !== null && typeof operatorId !== 'string' ||
    defuserId !== null && typeof defuserId !== 'string') throw new RangeError('Invalid demolition observation');
  const charge = campaign.demolition;
  if (campaign.outcome || campaign.stage !== 'sihang-defense' || !dt) return null;
  if (charge.state === 'detonated' || campaign.northWallBreached) return null;
  if (charge.state === 'armed') {
    if (defusing && defuserId) {
      charge.defuseInterruptedFor = 0;
      charge.defuserId = defuserId;
      charge.defuseProgress = Math.min(SIHANG_RULES.defuseSeconds, charge.defuseProgress + dt);
      if (charge.defuseProgress + 1e-8 >= SIHANG_RULES.defuseSeconds) {
        charge.disarmed++;
        Object.assign(charge, { state: 'idle', operatorId: null, installProgress: 0,
          defuserId: null, defuseProgress: 0, defuseInterruptedFor: 0, fuseRemaining: SIHANG_RULES.fuseSeconds,
          cooldownUntil: campaign.elapsed + SIHANG_RULES.demolitionCooldownSeconds });
        return 'disarmed';
      }
      return null;
    }
    charge.defuserId = null;
    charge.defuseInterruptedFor += dt;
    if (charge.defuseInterruptedFor + 1e-8 >= SIHANG_RULES.defuseGraceSeconds) charge.defuseProgress = 0;
    charge.fuseRemaining = Math.max(0, charge.fuseRemaining - dt);
    if (charge.fuseRemaining <= 1e-8) {
      charge.state = 'detonated'; campaign.northWallBreached = true;
      return 'detonated';
    }
    return null;
  }
  if (campaign.elapsed < charge.cooldownUntil) return null;
  if (!operatorId) {
    charge.state = 'idle'; charge.operatorId = null; charge.installProgress = 0;
    return null;
  }
  let event = null;
  if (charge.operatorId !== operatorId || charge.state !== 'installing') {
    charge.state = 'installing'; charge.operatorId = operatorId; charge.installProgress = 0;
    event = 'installing';
  }
  charge.installProgress = Math.min(SIHANG_RULES.installSeconds, charge.installProgress + dt);
  if (charge.installProgress + 1e-8 >= SIHANG_RULES.installSeconds) {
    charge.state = 'armed'; charge.fuseRemaining = SIHANG_RULES.fuseSeconds;
    charge.installations++; charge.defuserId = null; charge.defuseProgress = 0; charge.defuseInterruptedFor = 0;
    return 'armed';
  }
  return event;
}

export function advanceSihangCampaign(campaign, dt, { friendly = [], playerSquad = [], player = null, captureLost = false } = {}) {
  if (!Number.isFinite(dt) || dt < 0 || !Array.isArray(friendly) || !Array.isArray(playerSquad) ||
    typeof captureLost !== 'boolean') throw new RangeError('Invalid Sihang mission step');
  if (campaign.outcome || !dt) return campaign.outcome;
  campaign.elapsed += dt; campaign.stageElapsed += dt;
  const alive = actor => actor.health > 0 && !actor.vehicleId;
  if (campaign.stage === 'sihang-defense') {
    campaign.stageRemaining = Math.max(0, SIHANG_RULES.defenseSeconds - campaign.stageElapsed);
    if (captureLost) campaign.outcome = 'occupied';
    else if (!friendly.some(alive) && campaign.reserve === 0) campaign.outcome = 'exhausted';
    else if (campaign.stageRemaining <= 1e-8) {
      campaign.stage = 'sihang-retreat'; campaign.stageElapsed = 0;
      campaign.stageRemaining = null;
      campaign.retreatIds = friendly.filter(alive).map(actor => actor.id);
      campaign.aiRetreatIds = friendly.filter(actor => !actor.playerUnit && alive(actor)).map(actor => actor.id);
      campaign.retreatReserve = campaign.reserve;
      campaign.retreatTotal = campaign.retreatReserve + campaign.retreatIds.length;
      campaign.retreatRequired = Math.floor(campaign.retreatTotal / 2) + 1;
      Object.assign(campaign.demolition, { state: 'idle', installProgress: 0,
        operatorId: null, defuseProgress: 0, defuserId: null });
    }
  } else if (campaign.stage === 'sihang-retreat') {
    campaign.stageRemaining = null;
    const observed = new Map(friendly.map(actor => [actor.id, actor]));
    const saved = new Set(campaign.evacuatedIds), lost = new Set(campaign.retreatLostIds);
    for (const id of campaign.retreatIds) {
      if (saved.has(id) || lost.has(id)) continue;
      const actor = observed.get(id);
      if (!actor || !alive(actor)) { campaign.retreatLostIds.push(id); lost.add(id); }
      else if (campaign.assemblyReleased && sihangSafePosition(actor.position)) {
        campaign.evacuatedIds.push(id); saved.add(id);
      }
    }
    if (!campaign.counterattack && campaign.evacuatedIds.some(id => campaign.aiRetreatIds.includes(id))) {
      campaign.counterattack = true; campaign.counterattackAt = campaign.elapsed;
    }
    const status = sihangRetreatStatus(campaign);
    campaign.playerRetreatOpen = status.saved >= status.required;
    if (!status.unresolved) {
      campaign.outcome = campaign.playerRetreatOpen ? 'evacuated' : 'retreat-losses';
      campaign.strandedWatch = null; campaign.strandedCountdownAt = null;
    } else {
      const remaining = campaign.assemblyReleased && !campaign.retreatReserve &&
        status.unresolved <= SIHANG_RULES.strandedLimit
        ? campaign.retreatIds.filter(id => !saved.has(id) && !lost.has(id)).map(id => observed.get(id)) : [];
      const eligible = remaining.length === status.unresolved &&
        remaining.every(actor => actor && actor !== player && sihangNorthBank(actor.position) &&
          ['x', 'y', 'z'].every(axis => Number.isFinite(actor.position[axis])));
      if (!eligible) {
        campaign.strandedWatch = null; campaign.strandedCountdownAt = null;
      } else {
        const watch = campaign.strandedWatch;
        let moved = !watch || remaining.length !== watch.positions.size ||
          remaining.some(actor => !watch.positions.has(actor.id));
        if (!moved) for (const actor of remaining) {
          const previous = watch.positions.get(actor.id);
          previous.distance += Math.hypot(actor.position.x - previous.x, actor.position.y - previous.y,
            actor.position.z - previous.z);
          previous.x = actor.position.x; previous.y = actor.position.y; previous.z = actor.position.z;
          if (previous.distance >= .5) moved = true;
        }
        if (moved) {
          campaign.strandedWatch = { since: campaign.elapsed,
            positions: new Map(remaining.map(actor => [actor.id, {
              x: actor.position.x, y: actor.position.y, z: actor.position.z, distance: 0,
            }])) };
          campaign.strandedCountdownAt = null;
        } else if (campaign.strandedCountdownAt === null &&
          campaign.elapsed - watch.since >= SIHANG_RULES.strandedStillSeconds) {
          campaign.strandedCountdownAt = campaign.elapsed;
        }
        if (campaign.strandedCountdownAt !== null &&
          campaign.elapsed - campaign.strandedCountdownAt >= SIHANG_RULES.strandedCountdownSeconds)
          campaign.outcome = campaign.playerRetreatOpen ? 'evacuated' : 'retreat-losses';
      }
    }
  }
  return campaign.outcome;
}
