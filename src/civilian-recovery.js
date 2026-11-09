export function civilianRecoveryDue(data, position, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Civilian recovery requires simulation time');
  const goal = data.waitingSlot, target = data.route[data.waypoint];
  if (!goal || !target) return false;
  const goalDistance = Math.hypot(position.x - goal.x, position.z - goal.z);
  const targetDistance = Math.hypot(position.x - target.x, position.z - target.z);
  const state = data.finalRecovery ??= { lastProgress: now, retryAt: now, attempts: 0, active: false,
    route: data.route, waypoint: data.waypoint, targetDistance, goalDistance };
  state.progressX ??= position.x; state.progressZ ??= position.z;
  const sameRoute = state.route === data.route;
  const moved = Math.hypot(position.x - state.progressX, position.z - state.progressZ);
  if (moved >= .15 && (goalDistance < state.goalDistance - .25 || sameRoute &&
    (data.waypoint > state.waypoint || targetDistance < state.targetDistance - .15))) {
    state.lastProgress = now;
    state.progressX = position.x; state.progressZ = position.z;
    state.goalDistance = Math.min(state.goalDistance, goalDistance);
    state.targetDistance = targetDistance;
  }
  if (!sameRoute || state.waypoint !== data.waypoint) state.targetDistance = targetDistance;
  state.route = data.route; state.waypoint = data.waypoint;
  return now - state.lastProgress >= 12 && now >= state.retryAt;
}

export function installCivilianRecovery(data, path, now) {
  if (!Array.isArray(path) || !path.length || path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)))
    throw new Error('Civilian recovery requires a real navigable route');
  data.route = path.map(point => ({ x: point.x, z: point.z }));
  data.waypoint = 0; data.active = data.fleeReleased = true;
  data.resting = false; data.restPoseWeight = 0;
  data.crowdTarget = data.crowdPath = data.crowdSearch = null;
  data.crowdStalled = data.crowdPathStalled = 0;
  data.finalRecovery.active = true;
  data.finalRecovery.retryAt = now + 2;
}

export function stalledCivilianCandidates(civilians, now) {
  return civilians.filter(person => {
    const data = person.userData, recovery = data.finalRecovery;
    return !data.dead && !data.arrived && !data.boarding && !data.evacuated && !data.unrescued &&
      recovery?.attempts >= 3 && now - recovery.lastProgress >= 12;
  });
}

export function endCivilianRecoveryWait(campaign, civilians, now) {
  if (campaign.stage !== 'withdrawal-to-boats' || campaign.outcome)
    throw new Error('Unrescued civilian decisions require an active final withdrawal');
  const people = stalledCivilianCandidates(civilians, now);
  for (const person of people) person.userData.unrescued = true;
  campaign.civiliansUnrescued = (campaign.civiliansUnrescued ?? 0) + people.length;
  return people.length;
}
