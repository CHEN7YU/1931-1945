import { segmentClear } from './core.js';
import { BATTLE_AREA } from './battle-boundary.js';

export const CIVILIAN_THREAT = Object.freeze({ radius: 24, memorySeconds: 6, thinkSeconds: .65,
  personalSpace: 3, avoidRadius: 12, maximumThreats: 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function civilianStepAvoidsThreats(from, to, threats) {
  return threats.every(threat => {
    const before = distance(from, threat), after = distance(to, threat);
    const dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz;
    const along = lengthSquared ? Math.max(0, Math.min(1,
      ((threat.x - from.x) * dx + (threat.z - from.z) * dz) / lengthSquared)) : 0;
    const clearance = Math.hypot(from.x + dx * along - threat.x, from.z + dz * along - threat.z);
    if (before >= CIVILIAN_THREAT.avoidRadius) return clearance >= CIVILIAN_THREAT.avoidRadius;
    return after >= before - .015 && clearance >= before - .015;
  });
}

export function observeCivilianThreats(position, enemies, canSee) {
  const vehicles=new Set();
  return enemies.filter(enemy => {
    if(enemy.health<=0||enemy.vehicleId&&enemy.targetKind!=='closed-armor')return false;
    if(enemy.vehicleId&&vehicles.has(enemy.vehicleId))return false;
    if(enemy.vehicleId)vehicles.add(enemy.vehicleId);
    return enemy.health > 0 && (!enemy.vehicleId || enemy.targetKind === 'closed-armor') &&
    Math.abs(enemy.position.y - position.y) < 3 &&
    distance(position, enemy.position) <= CIVILIAN_THREAT.radius;
  })
    .sort((a, b) => distance(position, a.position) - distance(position, b.position)).slice(0, 4)
    .filter(enemy => canSee(position, enemy.position, enemy.vehicleId??null)).slice(0, CIVILIAN_THREAT.maximumThreats)
    .map(enemy => ({ x: enemy.position.x, y: enemy.position.y, z: enemy.position.z,
      ...(enemy.vehicleId?{vehicleId:enemy.vehicleId}:{}) }));
}

export function planCivilianEscape(position, routeTarget, threats, obstacles, concealed, lookup = null) {
  if (!threats.length) return { mode: 'route', target: routeTarget };
  const nearest = Math.min(...threats.map(threat => distance(position, threat)));
  const routeDistance = distance(position, routeTarget);
  const heading = Math.atan2(routeTarget.z - position.z, routeTarget.x - position.x);
  const candidates = [];
  for (const length of [3, 6]) for (const angle of [0, -.7, .7, -1.4, 1.4, -2.2, 2.2, Math.PI]) {
    const stride = angle === 0 ? Math.min(length, routeDistance) : length;
    const point = { x: position.x + Math.cos(heading + angle) * stride,
      y: position.y, z: position.z + Math.sin(heading + angle) * stride };
    if (point.x < BATTLE_AREA.minX + .38 || point.x > BATTLE_AREA.maxX - .38 ||
      point.z < BATTLE_AREA.minZ + .38 || point.z > BATTLE_AREA.maxZ - .38) continue;
    if (!civilianStepAvoidsThreats(position, point, threats) ||
      !segmentClear(position, point, .38, obstacles, lookup ? (x, z) => lookup.at(x, z) : undefined)) continue;
    const clearance = Math.min(...threats.map(threat => distance(point, threat)));
    if (clearance < CIVILIAN_THREAT.personalSpace && clearance <= nearest + .5) continue;
    candidates.push({ point, score: (routeDistance - distance(point, routeTarget)) * .7 +
      Math.min(20, clearance) - Math.min(20, nearest), covered: false });
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates.slice(0, 4)) {
    candidate.covered = threats.every(threat => concealed(candidate.point, threat));
    if (candidate.covered) candidate.score += 9;
  }
  candidates.sort((a, b) => b.score - a.score);
  const sheltered = threats.every(threat => concealed(position, threat));
  const routeUnsafe = !civilianStepAvoidsThreats(position, routeTarget, threats);
  if (sheltered && routeUnsafe || !candidates.length) return { mode: 'cower', target: null };
  return { mode: 'flee', target: candidates[0].point };
}

export function updateCivilianThreatResponse(data, position, target, enemies, obstacles, now, canSee, concealed, lookup = null, budget = null) {
  const response = data.threatResponse ??= { nextThinkAt: 0, until: 0, threats: [], mode: 'route', target: null };
  if (now < response.nextThinkAt) return response;
  if(budget&&budget.remaining<=0)return response;
  if(budget)budget.remaining--;
  data.threatThinkCount=(data.threatThinkCount??0)+1;
  response.nextThinkAt = now + CIVILIAN_THREAT.thinkSeconds + (data.civilianId % 7) * .025;
  const observed = observeCivilianThreats(position, enemies, canSee);
  if (observed.length) {
    response.threats = observed; response.until = now + CIVILIAN_THREAT.memorySeconds;
    data.panicked = true; data.panicStartedAt ??= now;
  } else if (now >= response.until) response.threats = [];
  Object.assign(response, planCivilianEscape(position, target, response.threats, obstacles, concealed, lookup));
  return response;
}
