import { NANJING_COURTYARDS, NANJING_SOLDIER_CAVE,
  NANJING_GATE_POSITIONS, NANJING_GATE_TUNNEL, NANJING_WALL_RAMPS, NANJING_WALL_WALK, NANJING_WALL_WALKS } from './nanjing-layout.js';

export const NANJING_STAGE_SECONDS = 3 * 60;

export function nanjingGateRegroupPost(index) {
  if (!Number.isInteger(index) || index < 0) throw new RangeError('Invalid gate regroup slot');
  return { x: -16 + index % 11 * 3.2, y: 0, z: 23 + Math.floor(index / 11) * 1.15 };
}
export const NANJING_GATE_CAPTURE_SECONDS = 20;
export const NANJING_BOAT_CAPACITY = 10;
export const NANJING_BOAT_COUNT = 5;
export const NANJING_DOCK = Object.freeze({ x: -66, z: -80, ferryX: -76 });
export const NANJING_CITY_WALLS = Object.freeze([
  Object.freeze({ minX: -74.2, maxX: -23.7, minZ: 16, maxZ: 20.4 }),
  Object.freeze({ minX: -74.2, maxX: -69.8, minZ: -68, maxZ: 16 }),
  Object.freeze({ minX: 23.7, maxX: 105, minZ: 16, maxZ: 20.4 }),
]);

export const NANJING_DOCK_ASSAULT_SPAWNS = Object.freeze([
  'nanjing-north-4', 'nanjing-north-5', 'nanjing-north-6',
  'nanjing-east-2', 'nanjing-east-4', 'nanjing-east-6', 'nanjing-south-3', 'nanjing-south-6',
]);

const assaultLanes = Array.from({ length: 8 }, (_, index) => {
  const across = -84 + index * 24;
  const along = -84 + index * 24;
  return [
    Object.freeze({ id: `nanjing-south-${index + 1}`, name: `中华门南路集结点 ${index + 1}`, team: 'enemy', kind: 'base', x: -62 + index * 21, z: index % 2 ? 96 : 84, altitude: 0, aiOnly: true }),
    Object.freeze({ id: `nanjing-north-${index + 1}`, name: `渡口北路集结点 ${index + 1}`, team: 'enemy', kind: 'base', x: across, z: -94, altitude: 0, aiOnly: true }),
    Object.freeze({ id: `nanjing-east-${index + 1}`, name: `渡口东路集结点 ${index + 1}`, team: 'enemy', kind: 'base', x: 82,
      z: index === 1 ? -72 : index === 3 ? -30 : index === 5 ? -12 : along, altitude: 0, aiOnly: true }),
  ];
}).flat();

export const NANJING_SPAWNS = Object.freeze([
  ...[
    { x: -4, minX: -9, maxX: 1 },
    { x: -16, minX: -21, maxX: -11 },
    { x: 11, minX: 5, maxX: 18 },
  ].map((zone, index) => Object.freeze({
    id: `nanjing-gate-front-${index}`, name: `中华门外沙袋阵地 ${index + 1}`,
    team: 'friendly', kind: 'base', x: zone.x, z: 27, altitude: 0, initialOnly: true, aiOnly: index !== 0,
    deploymentZone: Object.freeze({ minX: zone.minX, maxX: zone.maxX, minZ: 23, maxZ: 30 }),
  })),
  Object.freeze({ id: 'nanjing-gate', name: '中华门北墙内侧', team: 'friendly', kind: 'base',
    x: 2, z: NANJING_GATE_POSITIONS[0] + NANJING_GATE_TUNNEL.depth / 2 + 2.9, altitude: 0,
    deploymentZone: Object.freeze({ minX: -8.9, maxX: 8.9, minZ: -2.5, maxZ: 2.5 }) }),
  Object.freeze({ id: 'nanjing-gate-north-wall', name: '中华门北侧城墙 · 反扑阵地', team: 'friendly', kind: 'base',
    x: 0, z: NANJING_GATE_POSITIONS[0], altitude: NANJING_WALL_WALK.height,
    layout: 'wall', formationAxis: 'x' }),
  Object.freeze({ id: 'nanjing-gate-wall', name: '中华门东侧城墙', team: 'friendly', kind: 'base',
    x: (NANJING_WALL_WALK.minX + NANJING_WALL_WALK.maxX) / 2, z: 0,
    altitude: NANJING_WALL_WALK.height, layout: 'wall', formationZones: NANJING_COURTYARDS, aiOnly: true }),
  Object.freeze({ id: 'nanjing-gate-cave', name: '中华门东侧藏兵洞', team: 'friendly', kind: 'base',
    x: NANJING_SOLDIER_CAVE.x, z: NANJING_SOLDIER_CAVE.z,
    altitude: NANJING_SOLDIER_CAVE.floorHeight, layout: 'cave', aiOnly: true }),
  Object.freeze({ id: 'nanjing-south-armor', name: 'Yuhua Road桥南日军装甲点', team: 'enemy', kind: 'garage', x: -24, z: 92, altitude: 0, aiOnly: true }),
  Object.freeze({ id: 'nanjing-north-armor', name: '渡口北路日军装甲点', team: 'enemy', kind: 'garage', x: 90, z: -93, altitude: 0, aiOnly: true }),
  Object.freeze({ id: 'nanjing-south-air', name: '日军空中入场点', team: 'enemy', kind: 'air', x: 0, z: 98, altitude: 28, aiOnly: true }),
  Object.freeze({ id: 'nanjing-west-dock', name: '上新河渡口及附近', team: 'friendly', kind: 'base',
    x: NANJING_DOCK.x, z: NANJING_DOCK.z, altitude: 0, allowNearbyEnemies: true,
    deploymentZone: Object.freeze({ minX: -71, maxX: -46, minZ: -92, maxZ: -68 }) }),
  Object.freeze({ id: 'nanjing-west-ai-1', name: '渡口东北侧阵地', team: 'friendly', kind: 'base',
    x: -53, z: -88, altitude: 0, aiOnly: true, allowNearbyEnemies: true,
    deploymentZone: Object.freeze({ minX: -57, maxX: -44, minZ: -95, maxZ: -81 }) }),
  Object.freeze({ id: 'nanjing-west-ai-2', name: '渡口东南侧阵地', team: 'friendly', kind: 'base',
    x: -53, z: -73, altitude: 0, aiOnly: true, allowNearbyEnemies: true,
    deploymentZone: Object.freeze({ minX: -57, maxX: -44, minZ: -80, maxZ: -63 }) }),
  Object.freeze({ id: 'nanjing-reserve-1', name: '城内中部预备队集结点', team: 'friendly', kind: 'base',
    x: -16, z: -42, altitude: 0, aiOnly: true }),
  Object.freeze({ id: 'nanjing-reserve-2', name: '城内东街预备队集结点', team: 'friendly', kind: 'base',
    x: 14, z: -49, altitude: 0, aiOnly: true }),
  ...assaultLanes,
]);

export const NANJING_OBJECTIVES = Object.freeze([
  Object.freeze({ id: 'gate', name: '中华门第二道门内西侧', x: -6.2,
    z: NANJING_COURTYARDS[1].centerZ, radius: 2.6, capturePoint: true }),
  Object.freeze({ id: 'dock', name: '上新河渡口', x: NANJING_DOCK.x, z: NANJING_DOCK.z, radius: 15, capturePoint: false }),
]);

export function nanjingWallExitWaypoint(position) {
  const onRamp = NANJING_WALL_RAMPS.some(ramp => position.x >= ramp.minX - .5 &&
    position.x <= ramp.maxX + .5 && position.z >= ramp.minZ - .5 && position.z <= ramp.maxZ + .5);
  if (position.y > .025 && position.y < NANJING_WALL_WALK.height - .25 && !onRamp) return null;
  const side = position.x < 0 ? -1 : 1;
  const ramp = NANJING_WALL_RAMPS.find(candidate => candidate.side === side);
  if (position.y <= .025) {
    return Math.abs(position.x) > 8.6 && Math.abs(position.x) < Math.abs(ramp.side < 0 ? ramp.minX : ramp.maxX) &&
      position.z >= ramp.minZ - .5 && position.z <= ramp.maxZ + .5
      ? { x: side * 8.5, z: ramp.centerZ } : null;
  }
  if (Math.abs(position.z - ramp.centerZ) < .15) {
    return { x: side * 8.5, z: ramp.centerZ };
  }
  const walk = NANJING_WALL_WALKS.find(candidate => Math.sign(candidate.minX) === side);
  const wallX = (walk.minX + walk.maxX) / 2;
  if (Math.abs(position.x - wallX) > .1) return { x: wallX, z: position.z };
  if (Math.abs(position.z - ramp.centerZ) > .1) return { x: wallX, z: ramp.centerZ };
  return { x: side * 8.5, z: ramp.centerZ };
}

export function nanjingDefensePost(position, index, anchor) {
  if (position.y > 7) {
    const side = position.x < 0 ? -1 : 1;
    const wall = NANJING_WALL_WALKS.find(walk => Math.sign(walk.minX) === side);
    const wallX = (wall.minX + wall.maxX) / 2;
    if ((position.z < 17.5 || position.z > 20.7) && Math.abs(position.x) > 19) {
      return { x: wallX, y: wall.height, z: 18.2, transit: true };
    }
    return { x: (index % 11 - 5) * 1.65, y: wall.height, z: 19.9, transit: true };
  }
  return { x: anchor.x + (index % 5 - 2) * 1.25, z: 31 - Math.floor(index / 5) * 1.5, transit: true };
}

export function isNanjingSpawnAvailable(point, dockActivated) {
  if (point.initialOnly) return false;
  if (point.kind === 'rally') return true;
  return dockActivated ? point.id === 'nanjing-west-dock'
    : ['nanjing-gate', 'nanjing-gate-north-wall'].includes(point.id);
}

export function createNanjingObjectives() {
  return NANJING_OBJECTIVES.map(point => ({
    ...point, owner: point.id === 'gate' ? 'friendly' : null,
    control: point.id === 'gate' ? 1 : 0, progress: point.id === 'gate' ? 1 : 0,
    enemyProgress: 0, captured: point.id === 'gate', status: point.id === 'gate' ? 'held' : 'empty',
  }));
}

export function createNanjingCampaign() {
  return {
    stage: 'gate-defense',
    stageElapsed: 0,
    stageRemaining: NANJING_STAGE_SECONDS,
    reinforcementStopped: false,
    dockActivated: false,
    dockOverrun: false,
    dockContestedSeconds: 0,
    gateCaptureSeconds: 0,
    gateContested: false,
    requiredAISquads: 4,
    embarkOrderIssued: false,
    playerEscaped: false,
    playerBoardingBoatId: null,
    embarkFireBufferStartedAt: null,
    embarkFireBufferUntil: 0,
    boardedAISquads: [],
    outcome: null,
    civiliansArrived: 0,
    civiliansEvacuated: 0,
    civilianCasualties: 0,
    civiliansUnrescued: 0,
    civilianEnRouteCasualties: 0,
    civiliansWaiting: 0,
    civiliansAboard: 0,
    boats: Array.from({ length: NANJING_BOAT_COUNT }, (_, index) => ({
      id: index,
      passengers: 0,
      returning: false,
      departures: 0,
    })),
    evacuatedSquads: [],
  };
}

export function advanceNanjingGateCapture(campaign, dt, friendlyInside, enemyInside) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Gate capture requires finite non-negative time');
  if (campaign.stage !== 'gate-defense' || campaign.outcome) return;
  campaign.gateContested = friendlyInside && enemyInside;
  campaign.gateCaptureSeconds = enemyInside && !friendlyInside
    ? Math.min(NANJING_GATE_CAPTURE_SECONDS, campaign.gateCaptureSeconds + dt) : 0;
  if (campaign.gateCaptureSeconds === NANJING_GATE_CAPTURE_SECONDS) campaign.outcome = 'gate-overrun';
}

export function nanjingMissionVoice(campaign) {
  const stage = campaign.stage;
  const defense = stage === 'gate-defense' ? 'gate' : stage === 'dock-defense' ? 'dock' : null;
  const cue = defense && campaign.stageRemaining > 0
    ? `nanjing-${defense}-${Math.min(7, Math.ceil(campaign.stageRemaining / 60))}`
    : stage === 'withdrawal' ? 'nanjing-withdrawal' : null;
  if (!cue || campaign.presentedVoice === cue) return null;
  campaign.presentedVoice = cue;
  return cue;
}

export function advanceNanjingCampaign(campaign, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Nanjing campaign time must be finite and non-negative');
  if (campaign.outcome) return campaign.outcome;
  if (campaign.stage === 'gate-defense') {
    campaign.stageElapsed += dt;
    campaign.stageRemaining = Math.max(0, NANJING_STAGE_SECONDS - campaign.stageElapsed);
    if (campaign.stageRemaining === 0) {
      campaign.stage = 'withdrawal';
      campaign.reinforcementStopped = true;
    }
  } else if (campaign.stage === 'dock-defense') {
    campaign.stageElapsed += dt;
    campaign.stageRemaining = Math.max(0, NANJING_STAGE_SECONDS - campaign.stageElapsed);
    if (campaign.stageRemaining === 0 && !campaign.embarkOrderIssued) {
      campaign.embarkOrderIssued = true;
      campaign.stage = 'withdrawal-to-boats';
    }
  }
  if (campaign.dockOverrun && !campaign.playerEscaped) {
    campaign.outcome = 'fallen';
  } else if (campaign.playerEscaped) {
    campaign.outcome = 'evacuated';
  }
  return campaign.outcome;
}

export function activateNanjingDock(campaign) {
  if (campaign.stage !== 'withdrawal' || campaign.dockActivated) return false;
  campaign.dockActivated = true;
  campaign.reinforcementStopped = false;
  campaign.stage = 'dock-defense';
  campaign.stageElapsed = 0;
  campaign.stageRemaining = NANJING_STAGE_SECONDS;
  return true;
}

export function registerCivilianArrival(campaign, count = 1) {
  requireCount(count, 'arriving civilians');
  campaign.civiliansArrived += count;
  campaign.civiliansWaiting += count;
}

export function registerCivilianCasualties(campaign, count = 1, arrived = true) {
  requireCount(count, 'civilian casualties');
  const casualties = arrived ? Math.min(count, campaign.civiliansWaiting) : count;
  if (arrived) campaign.civiliansWaiting -= casualties;
  else campaign.civilianEnRouteCasualties += casualties;
  campaign.civilianCasualties += casualties;
  return casualties;
}

export function boardCivilian(campaign, boatId) {
  const boat = campaign.boats.find(candidate => candidate.id === boatId);
  if (!campaign.dockActivated || !boat || campaign.outcome || boat.returning ||
    boat.passengers >= NANJING_BOAT_CAPACITY || campaign.civiliansWaiting <= 0) return false;
  boat.passengers++;
  campaign.civiliansWaiting--;
  campaign.civiliansAboard++;
  if (boat.passengers === NANJING_BOAT_CAPACITY) {
    departNanjingBoat(campaign, boatId);
  }
  return true;
}

export function departNanjingBoat(campaign, boatId) {
  const boat = campaign.boats.find(candidate => candidate.id === boatId);
  if (!campaign.dockActivated || !boat || boat.returning || boat.passengers === 0 || campaign.outcome) return false;
  boat.returning = true;
  boat.departures++;
  return true;
}

export function completeNanjingCrossing(campaign, boatId) {
  const boat = campaign.boats.find(candidate => candidate.id === boatId);
  if (!boat || !boat.returning || boat.passengers === 0) return false;
  campaign.civiliansEvacuated += boat.passengers;
  campaign.civiliansAboard -= boat.passengers;
  boat.passengers = 0;
  return true;
}

export function returnNanjingBoat(campaign, boatId) {
  const boat = campaign.boats.find(candidate => candidate.id === boatId);
  if (!boat || !boat.returning || boat.passengers > 0) return false;
  boat.returning = false;
  return true;
}

export function recordNanjingSquadEvacuation(campaign, squadId, isPlayer = false) {
  if (typeof squadId !== 'string' || !squadId) throw new TypeError('An evacuating squad requires an id');
  if (campaign.outcome || campaign.civiliansWaiting > 0 || campaign.civiliansAboard > 0) return false;
  if (campaign.evacuatedSquads.some(squad => squad.id === squadId)) return false;
  if (campaign.stage !== 'withdrawal-to-boats') return false;
  if (isPlayer && !nanjingAISquadsBoarded(campaign)) return false;
  if (!isPlayer && campaign.evacuatedSquads.some(squad => squad.isPlayer)) return false;
  campaign.evacuatedSquads.push({ id: squadId, isPlayer });
  if (isPlayer) {
    campaign.playerEscaped = true;
    advanceNanjingCampaign(campaign, 0);
  }
  return true;
}

export function recordNanjingAISquadBoarding(campaign, squadId) {
  if (typeof squadId !== 'string' || !squadId) throw new TypeError('A boarding squad requires an id');
  if (campaign.outcome || campaign.stage !== 'withdrawal-to-boats' ||
    campaign.civiliansWaiting > 0 || campaign.civiliansAboard > 0 || campaign.boardedAISquads.includes(squadId)) return false;
  campaign.boardedAISquads.push(squadId);
  return true;
}

export function nanjingAIBoardedCount(campaign) {
  const ids = new Set(campaign.boardedAISquads);
  for (const squad of campaign.evacuatedSquads) if (!squad.isPlayer) ids.add(squad.id);
  return ids.size;
}

export function nanjingAISquadsBoarded(campaign) {
  return nanjingAIBoardedCount(campaign) >= campaign.requiredAISquads;
}

export function nanjingCivilianEvacuationStatus(campaign, civilians) {
  const enRoute = civilians.reduce((count, civilian) =>
    count + Number(!civilian.userData.dead && !civilian.userData.arrived && !civilian.userData.evacuated &&
      !civilian.userData.unrescued), 0);
  return { enRoute, waiting: campaign.civiliansWaiting, aboard: campaign.civiliansAboard,
    evacuated: campaign.civiliansEvacuated,
    ready: enRoute === 0 && campaign.civiliansWaiting === 0 && campaign.civiliansAboard === 0 };
}

export function overrunNanjingDock(campaign) {
  campaign.dockOverrun = true;
  advanceNanjingCampaign(campaign, 0);
}

function requireCount(count, label) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid ${label} count`);
}
