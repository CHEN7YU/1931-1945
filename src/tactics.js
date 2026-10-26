const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.z);

export function createTactics(id, squad, slot) {
  return { id, squad, slot: slot % 10, mode: 'advance', lastSeen: null, threatKind: 'person', forgetAt: 0, suppressedUntil: 0, cover: null, decisionAt: 0, arrivedAt: 0, enteredCover: false, blockedBy: null };
}

export function rememberThreat(state, position, now, kind = 'person') {
  state.lastSeen = { x: position.x, y: position.y, z: position.z };
  state.threatKind = kind;
  state.forgetAt = now + 5;
}

export function expireThreat(state, now) {
  if (state.lastSeen && now > state.forgetAt) {
    state.lastSeen = null;
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
  if (slot.kind === 'window') return [{ x: slot.x, z: slot.z }];
  if (slot.kind === 'door') return [{ ...slot.peek }];
  return [[.85, 0], [-.85, 0], [0, .85], [0, -.85]].map(([x, z]) => ({ x: slot.x + x, z: slot.z + z }));
}

export function selectCover({ state, position, threat, slots, claims, now, blocked, protectedAt, seesTarget, pathTo }) {
  const choices = [];
  for (const slot of slots) {
    const claim = claims.get(slot.id);
    if (claim && claim.until > now && claim.owner !== state.id) continue;
    const travel = distance(position, slot);
    if (travel > 23 || blocked(slot) || !protectedAt(slot, threat)) continue;
    const peek = coverPeeks(slot).find(point => !blocked(point) && seesTarget(point, threat));
    if (!peek) continue;
    choices.push({ ...slot, peek, score: travel + distance(peek, threat) * .06 + (slot.id === state.cover?.id ? -2 : 0) });
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

export function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z, length2 = dx * dx + dz * dz;
  const fraction = length2 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / length2)) : 0;
  return { distance: Math.hypot(point.x - start.x - fraction * dx, point.z - start.z - fraction * dz), fraction };
}
