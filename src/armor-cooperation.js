export const ARMOR_COOPERATION = Object.freeze({
  nearDistance: 16, maxApproach: 8, maxBacktrack: 4, rearDistance: 3.8, slots: 12,
});

export function chooseTankCover({ actor, vehicles, objective, threat, blocked, clear, reserved }) {
  if (actor.health <= 0 || actor.vehicleId || actor.playerUnit || actor.groundType !== 'infantry' || !objective) return null;
  const position = actor.position, danger = threat ?? objective;
  const remaining = Math.hypot(position.x - objective.x, position.z - objective.z);
  let best = null, bestScore = Infinity;
  for (const tank of vehicles) {
    if (tank.type !== 'tank' || tank.team !== actor.team || tank.health <= 0 ||
      Math.hypot(tank.position.x - position.x, tank.position.z - position.z) > ARMOR_COOPERATION.nearDistance) continue;
    const c = Math.cos(tank.heading), s = Math.sin(tank.heading);
    const local = point => ({ x: (point.x - tank.position.x) * c - (point.z - tank.position.z) * s,
      z: (point.x - tank.position.x) * s + (point.z - tank.position.z) * c });
    const hostile = local(danger);
    if (hostile.z >= -2) continue;
    const point = (x, z) => ({ x: tank.position.x + x * c + z * s, z: tank.position.z - x * s + z * c });
    for (let slot = 0; slot < ARMOR_COOPERATION.slots; slot++) {
      if (reserved(tank.id, slot)) continue;
      const x = (slot % 3 - 1) * .85, z = ARMOR_COOPERATION.rearDistance + Math.floor(slot / 3) * 1.35;
      // The line from the rear slot to the threat must actually cross the hull.
      const fraction = z / (z - hostile.z), crossing = x + (hostile.x - x) * fraction;
      if (Math.abs(crossing) > 1.05) continue;
      const goal = point(x, z), approach = Math.hypot(goal.x - position.x, goal.z - position.z);
      if (approach > ARMOR_COOPERATION.maxApproach ||
        Math.hypot(goal.x - objective.x, goal.z - objective.z) > remaining + ARMOR_COOPERATION.maxBacktrack ||
        blocked(goal) || !clear(position, goal)) continue;
      const side = slot % 3 === 0 ? -1 : slot % 3 === 2 ? 1 : actor.index % 2 ? -1 : 1;
      const peek = point(side * 2.3, z);
      const safePeek = !blocked(peek) && clear(goal, peek) ? peek : goal;
      const previous = actor.tactics.armorEscort;
      const score = approach + (previous?.vehicleId === tank.id && previous.slot === slot ? -2 : 0);
      if (score >= bestScore) continue;
      bestScore = score;
      best = { id: `armor:${tank.id}:${slot}`, kind: 'tank', vehicleId: tank.id, slot, ...goal, peek: safePeek };
    }
  }
  return best;
}
