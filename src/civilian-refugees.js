import { circleBlocked, segmentClear } from './core.js';

const varied = (id, salt = 0) => {
  const value = Math.sin((id + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const CROSS_ROTATIONS = [
  [[.94555668, -.38247283, -.72371359], [.02904117, .09193189, 2.53000051], [.67488478, .90142573, -1.98515034]],
  [[.94555668, .38247283, .72371359], [.02904117, -.09193189, -2.53000051], [.67488478, -.90142573, 1.98515034]],
];
const PARTS = ['Leg', 'Knee', 'Foot'];

function connection(point, route, clear) {
  let best = null;
  for (let index = 0; index + 1 < route.length; index++) {
    const a = route[index], b = route[index + 1], dx = b.x - a.x, dz = b.z - a.z;
    const length = dx * dx + dz * dz;
    if (!length) continue;
    const fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length));
    const join = { x: a.x + dx * fraction, z: a.z + dz * fraction };
    const distance = Math.hypot(point.x - join.x, point.z - join.z);
    if (distance > 8 || best && distance >= best.distance || !clear(join, point)) continue;
    best = { index, join, distance };
  }
  return best;
}

export function placeRefugeeRestGroups(streets, cityRoute, obstacles, lookup, count = 60) {
  const clear = point => !circleBlocked(point.x, point.z, .65, lookup.at(point.x, point.z));
  const lineClear = (a, b) => segmentClear(a, b, .36, obstacles, (x, z) => lookup.at(x, z));
  const candidates = [];
  for (const street of streets) for (let index = 0; index + 1 < street.points.length; index++) {
    const [ax, az] = street.points[index], [bx, bz] = street.points[index + 1];
    const length = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / length, tz = (bz - az) / length;
    for (let distance = 3; distance < length - 2; distance += 2) for (const side of [-1, 1]) {
      const x = ax + tx * distance, z = az + tz * distance;
      if (z > -14 || z < -66 || x < -55 || x > 40) continue;
      candidates.push({ x, z, tx, tz, nx: -tz * side, nz: tx * side, offset: street.width / 2 + .2,
        priority: Math.hypot(x, z + 12) });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority);
  const placed = [];
  let next = 0, group = 0;
  while (next < count) {
    const remaining = count - next;
    let size = remaining <= 5 ? remaining : [3, 5, 4, 5, 3][group % 5];
    if (remaining > size && remaining - size < 3) size = remaining - 3;
    let selected = null;
    for (const candidate of candidates) {
      const points = Array.from({ length: size }, (_, seat) => {
        const front = Math.ceil(size / 2), row = seat >= front ? 1 : 0;
        const rowSize = row ? size - front : front, column = row ? seat - front : seat;
        const along = (column - (rowSize - 1) / 2) * 1.8 + (varied(next + seat, 1) - .5) * .2;
        const outward = candidate.offset + row * 1.4 + varied(next + seat, 2) * .15;
        return { x: candidate.x + candidate.tx * along + candidate.nx * outward,
          z: candidate.z + candidate.tz * along + candidate.nz * outward };
      });
      if (points.some(point => !clear(point) || placed.some(other => Math.hypot(point.x - other.x, point.z - other.z) < 1.25)))
        continue;
      const joins = points.map(point => connection(point, cityRoute, lineClear));
      if (joins.some(join => !join || join.distance < 1.1)) continue;
      selected = points.map((point, seat) => ({ ...point, group, pose: (next + seat + group) % 4,
        heading: Math.atan2(-candidate.tx, -candidate.tz) + (varied(next + seat, 3) - .5) * 1.4,
        connection: joins[seat] }));
      break;
    }
    if (!selected) throw new Error(`No reachable roadside rest space for refugee group ${group}`);
    placed.push(...selected); next += size; group++;
  }
  return placed;
}

export function resetCivilianFlight(state) {
  state.encounterAt = null; state.encounterPoint = null; state.encounterGroup = null;
  state.voiceNotified = false; state.allReleasedAt = null;
}

export function advanceCivilianFlight(civilians, state, player, stage, dockActivated, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid civilian flight time');
  if (!['withdrawal', 'dock-defense', 'withdrawal-to-boats'].includes(stage)) return;
  if (state.encounterAt === null && player && player.y < 3 && player.z < -10) {
    const first = civilians.find(person => person.visible && !person.userData.dead &&
      person.userData.refugeeRestPoint && person.userData.resting &&
      Math.hypot(person.position.x - player.x, person.position.z - player.z) < 12);
    if (first) {
      state.encounterAt = now;
      state.encounterPoint = { x: first.position.x, z: first.position.z };
      state.encounterGroup = first.userData.restGroup;
    }
  }
  if (dockActivated && state.allReleasedAt === null) state.allReleasedAt = now;
  if (state.encounterAt === null && state.allReleasedAt === null) return;
  for (const person of civilians) {
    const data = person.userData;
    if (data.dead || data.evacuated || data.boarding || data.fleeReleased) continue;
    if (state.encounterAt !== null && data.flightReleaseAt === null) {
      const distance = Math.hypot(person.position.x - state.encounterPoint.x, person.position.z - state.encounterPoint.z);
      data.flightReleaseAt = data.openingWave && data.restGroup === state.encounterGroup
        ? state.encounterAt + .15 + varied(data.civilianId, 5) * 1.35
        : state.encounterAt + 2 + distance / 2.8 + varied(data.civilianId, 5) * (data.openingWave ? 6 : 24);
    }
    if (state.allReleasedAt !== null)
      data.flightReleaseAt = Math.min(data.flightReleaseAt ?? Infinity, state.allReleasedAt + varied(data.civilianId, 7) * 12);
    if (now < data.flightReleaseAt) continue;
    data.fleeReleased = true; data.releaseAt = now;
    if (data.refugeeRestPoint) {
      const branching = data.resting || data.waypoint >= data.refugeeRestRoute.length - 2;
      data.route = branching ? data.refugeeResumeRoute : data.homeRoute;
      if (branching) data.waypoint = 0;
      data.resting = false;
      data.crowdTarget = data.crowdPath = null;
      data.crowdSearch = null;
      data.crowdStalled = data.crowdPathStalled = 0;
    }
  }
}

export function applyCivilianRestPose(person) {
  const data = person.userData, weight = data.restPoseWeight ?? 0;
  if (!weight || data.dead || data.boarding) return;
  const joints = person.civilianSkin.joints;
  const pose = data.carrying !== 'none' && data.restPose === 1 ? 0 : data.restPose ?? 0;
  const blend = (node, axis, value) => { node.rotation[axis] += (value - node.rotation[axis]) * weight; };
  const cross = pose === 2, knees = pose === 3;
  joints.root.position.y += ((cross ? -.65 : knees ? -.707 : -.72) - joints.root.position.y) * weight;
  for (const [index, side] of ['left', 'right'].entries()) {
    if (cross) {
      for (let part = 0; part < 3; part++) {
        const joint = joints[`${side}${PARTS[part]}`], angles = CROSS_ROTATIONS[index][part];
        blend(joint, 'x', angles[0]); blend(joint, 'y', angles[1]); blend(joint, 'z', angles[2]);
      }
    } else {
      blend(joints[`${side}Leg`], 'x', knees ? 2.15 : 1.45);
      blend(joints[`${side}Knee`], 'x', knees ? -2.8 : .05);
      blend(joints[`${side}Foot`], 'x', knees ? .65 : -1.5);
    }
    if (data.carrying === 'child') continue;
    if (data.carrying === 'luggage' && index === 0) {
      blend(joints.leftArm, 'x', -.04); blend(joints.leftElbow, 'x', 1.3);
      continue;
    }
    blend(joints[`${side}Arm`], 'x', pose === 1 ? -.9 : knees ? .2 : cross ? .25 : .65);
    blend(joints[`${side}Elbow`], 'x', pose === 1 ? .05 : knees ? 1.9 : cross ? .8 : .7);
    blend(joints[`${side}Arm`], 'z', index ? -.08 : .08);
  }
  blend(joints.torso, 'x', pose === 1 ? .28 : knees ? -.35 : -.22);
  blend(joints.head, 'x', .12);
}

export function civilianBodyHeight(person) {
  const data = person.userData, weight = data.restPoseWeight ?? 0, pose = data.restPose ?? 0;
  const drop = pose === 2 ? .65 : pose === 3 ? .707 : .72;
  return (person.civilianSkin?.profile.height ?? 1) *
    (1.72 - (data.escapeMotion?.crouch ?? 0) * .65 * (1 - weight) - drop * weight);
}
