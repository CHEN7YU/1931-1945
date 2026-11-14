const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const copy = p => ({ x: p.x, y: p.y ?? 0, z: p.z });

export function createSquadRoutes(heightAt) {
  if (typeof heightAt !== 'function') throw new TypeError('Squad routes require the real walking surface height');
  const routes = new Map(), stats = { searches: 0, shared: 0, rejected: 0 };
  const eligible = actor => actor.formation?.type === 'infantry' && !actor.formation.sihangDemolition &&
    !actor.vehicleId && !actor.emplacementId && !actor.target && !actor.supportWeaponPose?.active &&
    (actor.stuckTime ?? 0) < .3;
  return {
    find(actor, goal, now, search, connect) {
      if (!Number.isFinite(now) || ![actor.position.x, actor.position.y, actor.position.z,
        goal.x, goal.z, goal.y ?? 0].every(Number.isFinite))
        throw new RangeError('Squad routing requires finite endpoints and simulation time');
      const key = `${actor.formation?.id}:${actor.formation?.generation ?? 0}:${actor.tactics?.preferredStair ?? ''}:${goal.routeGroup ?? ''}`;
      const entries = (routes.get(key) ?? []).filter(entry => now - entry.created < 4);
      const share = eligible(actor) && !goal.assembly && !goal.parade;
      if (share) for (const entry of entries) {
        if (distance(entry.goal, goal) > 5 || Math.abs(entry.goal.y - (goal.y ?? 0)) > .25) continue;
        const candidates = entry.points.map((point, index) => ({ point, index, distance: distance(actor.position, point) }))
          .filter(candidate => candidate.distance <= 7 && Math.abs(candidate.point.y - actor.position.y) <= .25)
          .sort((a, b) => a.distance - b.distance || b.index - a.index).slice(0, 3);
        const tail = entry.points.at(-1), end = copy(goal);
        const finish = distance(tail, end) < .001 ? [] : connect(tail, end);
        if (distance(tail, end) >= .001 && !finish.length) continue;
        for (const candidate of candidates) {
          const prefix = connect(actor.position, candidate.point);
          if (!prefix.length && candidate.distance > .001) continue;
          const path = [...prefix, ...entry.points.slice(candidate.index + 1), ...finish].map(copy);
          if (!path.length) path.push(end);
          stats.shared++;
          routes.set(key, entries);
          return path;
        }
        stats.rejected++;
      }
      stats.searches++;
      const path = search();
      if (share && path.length) {
        const points = [copy(actor.position)];
        for (const waypoint of path) {
          const previous = points.at(-1), count = Math.max(1, Math.ceil(distance(previous, waypoint) / 3));
          // Equal endpoint heights can still span an arched bridge. Stair risers keep their authored samples.
          for (let i = 1; i < count && Math.abs((waypoint.y ?? 0) - previous.y) < .025; i++) {
            const x = previous.x + (waypoint.x - previous.x) * i / count;
            const z = previous.z + (waypoint.z - previous.z) * i / count;
            const y = heightAt(x, z, previous.y);
            if (!Number.isFinite(y)) throw new RangeError('Squad route support height must be finite');
            points.push({ x, y, z });
          }
          points.push(copy(waypoint));
        }
        if (points.length <= 512) {
          entries.unshift({ goal: copy(goal), points, created: now });
          routes.set(key, entries.slice(0, 3));
          if (routes.size > 64) routes.delete(routes.keys().next().value);
        }
      }
      return path;
    },
    clear() { routes.clear(); },
    reset() { routes.clear(); stats.searches = stats.shared = stats.rejected = 0; },
    get snapshot() { return { ...stats, groups: routes.size }; },
  };
}
