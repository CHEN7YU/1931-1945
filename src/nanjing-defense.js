import { NANJING_GATE_POSITIONS, NANJING_WALL_RAMPS, NANJING_WALL_WALKS } from './nanjing-layout.js';

export function assignNanjingDefense(actors, now) {
  const defenders = actors.filter(actor => actor.health > 0 && !actor.vehicleId &&
    actor.friendly && !actor.playerUnit && !actor.formation.reserve);
  for (const formation of new Set(defenders.map(actor => actor.formation))) {
    formation.objectiveId = 'gate';
    const members = defenders.filter(actor => actor.formation === formation);
    const wallCount = Math.min(4, Math.floor(members.length * 4 / 11));
    const reserveCount = Math.min(2, Math.floor(members.length * 2 / 11));
    const quotas = { wall: wallCount, reserve: reserveCount, courtyard: members.length - wallCount - reserveCount };
    const retained = [];
    for (const actor of members) {
      const duty = actor.tactics.nanjingDefense;
      if (duty && quotas[duty.role] > 0) { quotas[duty.role]--; retained.push(actor); }
      else actor.tactics.nanjingDefense = null;
    }
    const available = members.filter(actor => !retained.includes(actor))
      .sort((a, b) => Number([9, 10].includes(b.index % 11)) - Number([9, 10].includes(a.index % 11)) ||
        a.index - b.index);
    for (const role of ['wall', 'courtyard', 'reserve']) {
      const used = new Set(retained.filter(actor => actor.tactics.nanjingDefense.role === role)
        .map(actor => actor.tactics.nanjingDefense.slot));
      for (let count = 0; count < quotas[role]; count++) {
        const actor = available.shift();
        let slot = 0;
        while (used.has(slot)) slot++;
        used.add(slot);
        actor.tactics.nanjingDefense = { role, slot, side: formation.index % 2 ? -1 : 1, assignedAt: now };
      }
      const assigned = members.filter(actor => actor.tactics.nanjingDefense?.role === role);
      const slots = new Set(assigned.map(actor => actor.tactics.nanjingDefense.slot));
      for (const actor of assigned.filter(actor => actor.tactics.nanjingDefense.slot >= assigned.length)) {
        let slot = 0;
        while (slots.has(slot)) slot++;
        slots.add(slot);
        actor.tactics.nanjingDefense.slot = slot;
      }
    }
  }
  return defenders;
}

export function nanjingDefenseGoal(actor, { breached = false, emergency = false } = {}) {
  const duty = actor.tactics.nanjingDefense;
  if (!duty) return null;
  const { role, side, slot } = duty;
  // Only one wall soldier per squad reinforces the ground; the rest retain overwatch.
  const reinforce = role === 'wall' && slot === 3 && emergency;
  if (role === 'wall' && !reinforce) {
    if (duty.firePost && duty.firePost.breached === breached) return duty.firePost;
    return { x: side * (3.3 + slot * 1.65), y: NANJING_WALL_WALKS[0].height,
      z: NANJING_GATE_POSITIONS[2] + (breached ? -1.7 : 1.7), transit: true };
  }
  if (reinforce) return { x: side * 3, z: 10.3, y: 0, transit: true };
  if (role === 'reserve') {
    return emergency
      ? { x: -6.2 + side * .9, z: slot ? 1.65 : -1.65, y: 0, transit: true }
      : breached
        ? { x: side * (3 + slot * 1.7), z: 10.3, y: 0, transit: true }
        : { x: side * (1.5 + slot * 1.65), z: .7, y: 0, transit: true };
  }
  if (slot === 0) return { x: -6.2 + side * 1.3, z: 0, y: 0, transit: true };
  if (slot >= 5) return { x: side * 1.5, z: 10.3, y: 0, transit: true };
  return { x: side * (2.1 + (slot - 1) * 1.6), z: 13.2, y: 0, transit: true };
}

export function nanjingWallEntryWaypoint(position, side) {
  if (position.y >= NANJING_WALL_WALKS[0].height - .02) return null;
  const ramp = NANJING_WALL_RAMPS.find(candidate => candidate.side === side);
  if (Math.abs(position.z - ramp.centerZ) > .4) {
    return { x: side * 8.3, z: ramp.centerZ, y: 0, transit: true };
  }
  return { x: side * 21.5, z: ramp.centerZ, y: ramp.height, transit: true, ramp: true };
}
