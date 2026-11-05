import { circleBlocked, createNavigator, moveGround, segmentClear } from './core.js';
import { vehicleCollider } from './entities.js';
import { CHI_HA } from './chi-ha.js';

const navigationClearance = CHI_HA.clearance + .1;
const movingArmor = vehicle => vehicle.health > 0 && vehicle.variant === CHI_HA.id &&
  !['hold', 'engage'].includes(vehicle.ai?.mode);
function pathLength(start, path) {
  let length = 0, from = start;
  for (const point of path) { length += Math.hypot(point.x - from.x, point.z - from.z); from = point; }
  return length;
}

function trafficObstacles(vehicle, vehicles) {
  return vehicles.filter(other => other.id !== vehicle.id && other.type === 'tank').map(other => {
    const hull = vehicleCollider(other), radius = Math.hypot(hull.hx, hull.hz);
    // Reserve the entire turning envelope, not just the current hull orientation.
    return { id: other.id, circular: true, cx: hull.cx, cz: hull.cz, radius,
      minX: hull.cx - radius, maxX: hull.cx + radius, minZ: hull.cz - radius, maxZ: hull.cz + radius };
  });
}

export function createTankNavigation(obstacles) {
  const views = new Map();
  let staticNavigate = null;
  return {
    canSpawn(position, vehicles) {
      return !circleBlocked(position.x, position.z, navigationClearance,
        [...obstacles, ...trafficObstacles({ id: null }, vehicles)]);
    },
    pathTo(vehicle, goal, vehicles) {
      const ids = new Set(vehicles.map(other => other.id));
      for (const id of views.keys()) if (!ids.has(id)) views.delete(id);
      const traffic = trafficObstacles(vehicle, vehicles.filter(other => !movingArmor(other) ||
        Math.hypot(other.position.x - vehicle.position.x, other.position.z - vehicle.position.z) <= 12));
      let view = views.get(vehicle.id);
      if (!view) {
        const source = [...obstacles, ...traffic];
        view = { source, traffic, navigate: createNavigator(source, 1.5, navigationClearance) };
        views.set(vehicle.id, view);
      } else {
        view.source.splice(0, view.source.length, ...obstacles, ...traffic);
        const changed = [...view.traffic, ...traffic].filter(item => {
          const previous = view.traffic.find(other => other.id === item.id);
          const next = traffic.find(other => other.id === item.id);
          return !previous || !next || previous.cx !== next.cx || previous.cz !== next.cz;
        });
        if (changed.length) view.navigate.refresh({
          minX: Math.min(...changed.map(item => item.minX)), maxX: Math.max(...changed.map(item => item.maxX)),
          minZ: Math.min(...changed.map(item => item.minZ)), maxZ: Math.max(...changed.map(item => item.maxZ)),
        });
        view.traffic = traffic;
      }
      const path = view.navigate(vehicle.position, goal);
      view.stats = { ...view.navigate.stats, trafficPolicy: 'avoid' };
      if (vehicles.some(other => other.id !== vehicle.id && movingArmor(other) &&
        Math.hypot(other.position.x - vehicle.position.x, other.position.z - vehicle.position.z) <= 12)) {
        staticNavigate ??= createNavigator(obstacles, 1.5, navigationClearance);
        const convoy = staticNavigate(vehicle.position, goal);
        const stationary = trafficObstacles(vehicle, vehicles.filter(other => !movingArmor(other)));
        let from = vehicle.position;
        const usable = convoy.length > 0 && convoy.every(point => {
          const clear = segmentClear(from, point, navigationClearance, stationary);
          from = point;
          return clear;
        });
        if (usable && (!path.length || pathLength(vehicle.position, path) > pathLength(vehicle.position, convoy) + 12)) {
          // Queue behind moving armor instead of treating it as a permanent road closure.
          view.stats = { ...staticNavigate.stats, trafficPolicy: 'convoy' };
          return convoy;
        }
      }
      return path;
    },
    canTravel(vehicle, from, to, vehicles) {
      return segmentClear(from, to, navigationClearance, [...obstacles, ...trafficObstacles(vehicle, vehicles)]);
    },
    stats(vehicle) { const stats = views.get(vehicle.id)?.stats; return stats ? { ...stats } : null; },
    move(vehicle, dx, dz, vehicles) {
      const position = vehicle.position;
      const traffic = trafficObstacles(vehicle, vehicles);
      const yielding = vehicles.find(other => {
        if (other.id === vehicle.id || !movingArmor(other) || !other.ai ||
          other.ai.objectiveId !== vehicle.ai?.objectiveId) return false;
        const distance = Math.hypot(position.x - other.position.x, position.z - other.position.z);
        const difference = other.ai.distanceToObjective - vehicle.ai.distanceToObjective;
        const priority = difference < -1 || Math.abs(difference) <= 1 && other.id < vehicle.id;
        const approaching = Math.hypot(position.x + dx - other.position.x, position.z + dz - other.position.z) < distance;
        return priority && (vehicle.ai.trafficYieldId === other.id ? distance < 10.5 : distance < 9 && approaching);
      });
      if (yielding) {
        vehicle.ai.trafficYieldId = yielding.id;
        const reverse = Math.hypot(dx, dz) * .55;
        moveGround(position, Math.sin(vehicle.heading) * reverse, Math.cos(vehicle.heading) * reverse,
          CHI_HA.clearance, [...obstacles, ...traffic]);
        return { yielding: true, reversing: true };
      }
      vehicle.ai.trafficYieldId = null;
      moveGround(position, dx, dz, CHI_HA.clearance, [...obstacles, ...traffic]);
      return { yielding: false, reversing: false };
    },
    refreshMany(regions) {
      staticNavigate?.refreshMany(regions);
      for (const view of views.values()) {
        view.source.splice(0, view.source.length, ...obstacles, ...view.traffic);
        view.navigate.refreshMany(regions);
      }
    },
    refresh(bounds) { this.refreshMany([bounds]); },
    reset() { views.clear(); staticNavigate = null; },
  };
}
