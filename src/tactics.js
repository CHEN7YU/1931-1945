import { soldierPostureHeight, soldierEyePosition } from './entities.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.z);

export function createTactics(id, squad, slot) {
  return { id, squad, slot: slot % 10, mode: 'advance', lastSeen: null, threatKind: 'person', threatSense: null, threatId: null,
    observedAt: null, engagementPoint: null, lastSightCheck: null, forgetAt: 0, suppressedUntil: 0, cover: null, decisionAt: 0, arrivedAt: 0, enteredCover: false, blockedBy: null };
}

export function rememberThreat(state, position, now, kind = 'person', sense = 'vision', targetId = null) {
  if (!validPoint(position) || !Number.isFinite(position.y) || !Number.isFinite(now) || now < 0 ||
      !['vision', 'sound'].includes(sense) || (targetId !== null && (typeof targetId !== 'string' || !targetId))) {
    throw new RangeError('Threat observations require finite coordinates/time and an explicit sense/identity');
  }
  state.lastSeen = { x: position.x, y: position.y, z: position.z };
  state.threatKind = kind;
  state.threatSense = sense;
  state.threatId = sense === 'vision' ? targetId : null;
  state.observedAt = now;
  state.engagementPoint = null;
  if (sense === 'vision' && targetId) state.lastSightCheck = { time: now, targetId, visible: true };
  state.forgetAt = now + (sense === 'sound' ? 3 : 5);
}

export function targetAimPoint(target) {
  if (!target || !validPoint(target.position) || !Number.isFinite(target.position.y)) throw new RangeError('Target position must be finite');
  return { x: target.position.x, y: target.position.y + soldierPostureHeight(target, 'aim'), z: target.position.z };
}

export function visibleTargetPoint(target, canSee) {
  if (typeof canSee !== 'function') throw new TypeError('Target visibility requires a query');
  let point = targetAimPoint(target);
  const query = candidate => {
    const result = canSee(candidate);
    if (typeof result !== 'boolean') throw new TypeError('Visibility query must return a boolean');
    return result;
  };
  let visible = query(point);
  if (!visible && !target.vehicleId && target.nativeMotion && soldierPostureHeight(target) < 1.55) {
    const head = soldierEyePosition(target);
    if (query(head)) { point = head; visible = true; }
  }
  return visible ? point : null;
}

export function observeVisualThreat(state, target, now, canSee) {
  if (!Number.isFinite(now) || now < 0 || typeof canSee !== 'function' ||
      !target || typeof target.id !== 'string' || !target.id) throw new RangeError('Visual observation requires simulation time, target identity and a visibility query');
  const point = visibleTargetPoint(target, canSee);
  state.lastSightCheck = { time: now, targetId: target.id, visible: Boolean(point) };
  if (!point) return null;
  rememberThreat(state, point, now, target.targetKind, 'vision', target.id);
  return point;
}

export function expireThreat(state, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Threat expiry requires finite non-negative simulation time');
  if (state.lastSeen && now > state.forgetAt) {
    state.lastSeen = null;
    state.threatSense = state.threatId = state.observedAt = state.engagementPoint = null;
    state.lastSightCheck = null;
    state.threatKind = 'person';
    state.cover = null;
    state.mode = 'advance';
    return true;
  }
  return false;
}

export function friendlyCoverAction(state, position, now) {
  if (!validPoint(state.cover) || !validPoint(state.cover.peek) || !validPoint(position) || !Number.isFinite(now) || now < 0) {
    throw new RangeError('Cover movement requires an assigned cover, finite position and simulation time');
  }
  const exposed = state.enteredCover && now >= state.suppressedUntil && peekTurn(state, now);
  const goal = exposed ? state.cover.peek : state.cover;
  const travel = distance(position, goal), moving = travel > .15;
  if (state.cover.kind === 'wall-support') return { goal: state.cover, moving, sprint: moving && travel > 1.2,
    mayFire: !moving && now >= state.suppressedUntil, mode: moving ? 'rush-to-cover' : 'wall-supported-fire' };
  return { goal, moving, sprint: moving && (!state.enteredCover ? travel > 1.2 : !exposed && travel > .4),
    mayFire: exposed && !moving,
    mode: !state.enteredCover ? 'rush-to-cover' :
      moving ? exposed ? 'move-to-peek' : 'withdraw-to-cover' : exposed ? 'peek' : 'cover' };
}

export function peekTurn(state, now) {
  if (now < state.suppressedUntil && now - state.arrivedAt < 1.4) return false;
  return Math.floor((now + state.squad * .37) / 2.6) % 2 === state.slot % 2;
}

export function coverPeeks(slot) {
  if (slot.kind === 'window' || slot.kind === 'wall-support') return [{ x: slot.x, z: slot.z }];
  if (slot.kind === 'door') return [{ ...slot.peek }];
  return [[.85, 0], [-.85, 0], [0, .85], [0, -.85]].map(([x, z]) => ({ x: slot.x + x, z: slot.z + z }));
}

export function selectCover({ state, position, threat, slots, claims, now, blocked, protectedAt, supportedAt = () => false, seesTarget, pathTo }) {
  const choices = [];
  for (const slot of slots) {
    const claim = claims.get(slot.id);
    if (claim && claim.until > now && claim.owner !== state.id) continue;
    const travel = distance(position, slot);
    const support = slot.kind === 'wall-support';
    if (travel > (support ? 7 : 23) || blocked(slot) || !(support ? supportedAt(slot, threat) : protectedAt(slot, threat))) continue;
    const peek = coverPeeks(slot).find(point => !blocked(point) && seesTarget(point, threat));
    if (!peek) continue;
    choices.push({ ...slot, peek, score: travel + distance(peek, threat) * .06 + (support ? 6 : 0) + (slot.id === state.cover?.id ? -2 : 0) });
  }
  choices.sort((a, b) => a.score - b.score);
  for (const choice of choices.slice(0, 5)) {
    const path = pathTo(choice);
    if (!path.length) continue;
    if (state.cover && state.cover.id !== choice.id) claims.delete(state.cover.id);
    claims.set(choice.id, { owner: state.id, until: now + 7 });
    return { cover: choice, path };
  }
  return null;
}

export function objectiveDestination(state, position, objective) {
  if (!validPoint(position) || !validPoint(objective) || !Number.isFinite(objective.radius) || objective.radius <= 0 ||
    !Number.isInteger(state.slot) || !Number.isInteger(state.squad)) throw new RangeError('Objective advance requires an assigned squad and capture area');
  const lane = (state.squad % 3 - 1) * 3.2;
  const slot = state.slot % 10, x = lane + (slot % 3 - 1) * 1.1, z = (Math.floor(slot / 3) - 1.5) * 1.25;
  const scale = Math.min(1, (objective.radius - 1) / Math.max(1, Math.hypot(x, z)));
  return { x: objective.x + x * scale, z: objective.z + z * scale };
}

export function objectiveAdvanceRequired(actor, objective, threatDistance, closeRange = 35) {
  if (!validPoint(actor.position) || !validPoint(objective) || !Number.isFinite(objective.radius) ||
    !Number.isFinite(threatDistance) || threatDistance < 0) throw new RangeError('Mission decision needs finite objective and observed distance');
  if (!actor.friendly || actor.playerUnit && actor.order !== 'advance') return false;
  if (Math.hypot(actor.position.x - objective.x, actor.position.z - objective.z) <= objective.radius * .7) return false;
  // One stable covering element per squad; the remaining soldiers keep closing on the objective.
  return threatDistance > closeRange ? actor.tactics.slot % 4 !== 0 :
    threatDistance > 18 && actor.tactics.slot % 3 !== 0;
}

export function advancePosition(state, position, objective) {
  const slotX = state.slot % 2 ? 1.4 : -1.4;
  const lane = (state.squad % 3 - 1) * 14.5;
  if (objective.z > -10 && position.z < -26) return { x: 8 + lane + slotX, z: Math.min(-25, position.z + 14) };
  if (objective.z > -10 && position.z < -7) return { x: 8 + slotX, z: -6 };
  if (objective.z > position.z + 14) return { x: lane + slotX, z: Math.min(objective.z - 12, position.z + 14) };
  const angle = state.slot * Math.PI / 2 + state.squad % 3 * .35;
  const radius = 5 + state.squad % 3 * 2;
  return { x: objective.x + Math.cos(angle) * radius, z: objective.z + Math.sin(angle) * radius };
}

export function assignAssaultObjectives(formations, objectives) {
  if (!objectives.length) throw new RangeError('Assault assignments require objectives');
  for (const team of ['friendly', 'enemy']) {
    const units = formations.filter(item => item.team === team && !item.player).map(formation => {
      const alive = formation.members.filter(actor => actor.health > 0 && !actor.vehicleId);
      return { formation, alive, center: alive.reduce((sum, actor) => ({
        x: sum.x + actor.position.x / alive.length, z: sum.z + actor.position.z / alive.length,
      }), { x: 0, z: 0 }) };
    }).filter(unit => unit.alive.length);
    const secured = point => point.owner === team && point.status !== 'contested' &&
      point.control === (team === 'friendly' ? 1 : -1);
    const quotas = new Map(objectives.map(point => [point.id, 0]));
    let remaining = units.length;
    for (const point of objectives.filter(secured)) {
      if (!remaining) break;
      quotas.set(point.id, 1);
      remaining--;
    }
    const targets = objectives.filter(point => !secured(point));
    const attackPoints = targets.length ? targets : objectives;
    while (remaining-- > 0) {
      const point = attackPoints.reduce((best, candidate) => quotas.get(candidate.id) < quotas.get(best.id) ? candidate : best);
      quotas.set(point.id, quotas.get(point.id) + 1);
    }
    const assigned = new Set();
    // Keep committed attackers, preferring those already closest when a quota shrinks.
    for (const point of objectives) {
      const incumbents = units.filter(unit => unit.formation.objectiveId === point.id)
        .sort((a, b) => distance(a.center, point) - distance(b.center, point));
      for (const unit of incumbents.slice(0, quotas.get(point.id))) {
        assigned.add(unit);
        quotas.set(point.id, quotas.get(point.id) - 1);
      }
    }
    for (const unit of units.filter(item => !assigned.has(item))) {
      const available = objectives.filter(point => quotas.get(point.id) > 0);
      const point = available.reduce((best, candidate) => distance(unit.center, candidate) < distance(unit.center, best) ? candidate : best);
      unit.formation.objectiveId = point.id;
      quotas.set(point.id, quotas.get(point.id) - 1);
    }
  }
}

export function assaultDestination(actor, objective) {
  const angle = actor.index * Math.PI * 2 / 11 + actor.formation.index * 2.4;
  const radius = Math.min(objective.radius - 2, 3 + actor.index % 3 * 1.8);
  return { x: objective.x + Math.cos(angle) * radius, z: objective.z + Math.sin(angle) * radius };
}

export function enemyAssaultAction(state, position, objective, now, hasTarget) {
  if (!validPoint(position) || !validPoint(objective) || !Number.isFinite(now) || now < 0) {
    throw new RangeError('Assault decisions require finite positions and simulation time');
  }
  if (state.lastSeen && state.threatKind === 'closed-armor') return 'cover';
  if (distance(position, objective) < objective.radius - 2) return hasTarget ? 'cover' : 'advance';
  if (now < state.suppressedUntil && now >= (state.assaultSuppressionReadyAt ?? 0)) {
    state.assaultSuppressionUntil = now + 1.5;
    state.assaultSuppressionReadyAt = now + 7;
  }
  if (now < (state.assaultSuppressionUntil ?? 0) && state.lastSeen) return 'cover';
  if (!hasTarget) return 'advance';
  // Half a section covers for a bounded interval while the other half closes on its objective.
  return Math.floor((now + state.squad * .37) / 4) % 2 === state.slot % 2 ? 'advance' : 'cover';
}

export function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z, length2 = dx * dx + dz * dz;
  const fraction = length2 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / length2)) : 0;
  return { distance: Math.hypot(point.x - start.x - fraction * dx, point.z - start.z - fraction * dz), fraction };
}
