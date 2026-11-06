export const SIHANG_RULES = Object.freeze({
  defenseSeconds: 240, retreatSeconds: 300, troopLimit: 400, squadMembers: 11,
  demolitionMembers: 20, installSeconds: 10, fuseSeconds: 10, defuseSeconds: 10,
});

export function createSihangCampaign() {
  return {
    stage: 'sihang-defense', stageElapsed: 0, stageRemaining: SIHANG_RULES.defenseSeconds,
    elapsed: 0, reserve: SIHANG_RULES.troopLimit, deployed: 0, outcome: null,
    aiRetreatIds: [], evacuatedIds: [], playerRetreatOpen: false, warnings: [],
    demolition: { state: 'idle', operatorId: null, installProgress: 0,
      fuseRemaining: SIHANG_RULES.fuseSeconds, defuseProgress: 0, defuserId: null,
      cooldownUntil: 0, installations: 0, disarmed: 0 },
  };
}

export function sihangDeploymentCount(campaign, requested = SIHANG_RULES.squadMembers) {
  if (!Number.isInteger(requested) || requested < 1 || requested > SIHANG_RULES.squadMembers)
    throw new RangeError('Invalid Sihang replacement squad size');
  return campaign.outcome || campaign.stage !== 'sihang-defense' ? 0 : Math.min(requested, campaign.reserve);
}

export function registerSihangDeployment(campaign, count) {
  if (!Number.isInteger(count) || count < 1 || count > sihangDeploymentCount(campaign))
    throw new RangeError('Sihang deployment exceeds its remaining troop budget');
  campaign.reserve -= count; campaign.deployed += count;
}

export function sihangSafePosition(position) {
  return Boolean(position && Number.isFinite(position.z) && Number.isFinite(position.y) &&
    position.z >= 36 && position.y >= -.25);
}

export function sihangEnemyMayAttack(position) {
  return Boolean(position && Number.isFinite(position.z) && position.z < 32);
}

export function advanceSihangDemolition(campaign, dt, { operatorId = null, defusing = false, defuserId = null } = {}) {
  if (!Number.isFinite(dt) || dt < 0 || typeof defusing !== 'boolean' ||
    operatorId !== null && typeof operatorId !== 'string' ||
    defuserId !== null && typeof defuserId !== 'string') throw new RangeError('Invalid demolition observation');
  const charge = campaign.demolition;
  if (campaign.outcome || campaign.stage !== 'sihang-defense' || !dt) return null;
  if (charge.state === 'armed') {
    if (defusing && defuserId) {
      if (charge.defuserId !== defuserId) charge.defuseProgress = 0;
      charge.defuserId = defuserId;
      charge.defuseProgress = Math.min(SIHANG_RULES.defuseSeconds, charge.defuseProgress + dt);
      if (charge.defuseProgress + 1e-8 >= SIHANG_RULES.defuseSeconds) {
        charge.disarmed++;
        Object.assign(charge, { state: 'idle', operatorId: null, installProgress: 0,
          defuserId: null, defuseProgress: 0, fuseRemaining: SIHANG_RULES.fuseSeconds,
          cooldownUntil: campaign.elapsed + 10 });
        return 'disarmed';
      }
      return null;
    }
    charge.defuserId = null; charge.defuseProgress = 0;
    charge.fuseRemaining = Math.max(0, charge.fuseRemaining - dt);
    if (charge.fuseRemaining <= 1e-8) {
      charge.state = 'detonated'; campaign.outcome = 'demolished';
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
    charge.installations++; charge.defuserId = null; charge.defuseProgress = 0;
    return 'armed';
  }
  return event;
}

export function advanceSihangCampaign(campaign, dt, { friendly = [], player = null, playerSquad = [], captureLost = false } = {}) {
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
      campaign.stageRemaining = SIHANG_RULES.retreatSeconds;
      campaign.aiRetreatIds = friendly.filter(actor => !actor.playerUnit && alive(actor)).map(actor => actor.id);
      Object.assign(campaign.demolition, { state: 'idle', installProgress: 0,
        operatorId: null, defuseProgress: 0, defuserId: null });
    }
  } else if (campaign.stage === 'sihang-retreat') {
    campaign.stageRemaining = Math.max(0, SIHANG_RULES.retreatSeconds - campaign.stageElapsed);
    for (const actor of friendly.filter(alive)) {
      if (sihangSafePosition(actor.position) && !campaign.evacuatedIds.includes(actor.id))
        campaign.evacuatedIds.push(actor.id);
    }
    campaign.playerRetreatOpen = campaign.aiRetreatIds.every(id => {
      const actor = friendly.find(candidate => candidate.id === id);
      return !actor || !alive(actor) || campaign.evacuatedIds.includes(id);
    });
    if (!playerSquad.some(alive)) campaign.outcome = 'squad-lost';
    else if (campaign.playerRetreatOpen && player && alive(player) && sihangSafePosition(player.position))
      campaign.outcome = 'evacuated';
    else if (campaign.stageRemaining <= 1e-8) campaign.outcome = 'timeout';
  }
  return campaign.outcome;
}
