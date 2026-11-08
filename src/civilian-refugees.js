import { circleBlocked, segmentClear } from './core.js';
import { Vector3, Object3D } from 'three';
import { solveArm } from './nra-rifle-pose.js';

const varied = (id, salt = 0) => {
  const value = Math.sin((id + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const seatedContacts = new WeakMap();

export function applyCivilianSeatedContacts(person, weight, hugging = false) {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError('Seated contacts need a bounded blend');
  if (!weight) return;
  const skin = person.civilianSkin, joints = skin.joints;
  let state = seatedContacts.get(person);
  if (!state) {
    const palms = {};
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const palm = new Object3D();
      palm.position.set(sign * .002, -.285, -.005); joints[`${side}Elbow`].add(palm);
      palms[side] = palm;
    }
    state = { palms, ground: new Map(), poses: new Map() }; seatedContacts.set(person, state);
  }
  const key = `${skin.level}:${hugging}:${person.userData.restPose ?? 0}`;
  const cached = weight === 1 ? state.poses.get(key) : null;
  if (cached) {
    for (const [name, rotation] of cached.rotations) joints[name].quaternion.copy(rotation);
    joints.root.position.y = cached.rootY;
    person.userData.seatedContacts = cached.contacts;
    return;
  }
  const visual = skin.mesh.parent, originalWidth = visual.scale.x;
  // Solve the native two-bone chains in an isotropic frame; restore authored body width before projection.
  const errors = {};
  const facing = person.getWorldQuaternion(joints.root.quaternion.clone());
  const kneeContact = (side, sign) => joints[`${side}Knee`].getWorldPosition(new Vector3())
    .add(new Vector3(sign * .012, hugging ? .03 : .06, hugging ? -.075 : -.025)
      .multiply(visual.scale).applyQuaternion(facing));
  visual.scale.x = visual.scale.y;
  person.updateMatrixWorld(true);
  try {
  for (const side of ['left', 'right']) {
    const leg = joints[`${side}Leg`], knee = joints[`${side}Knee`], foot = joints[`${side}Foot`];
    const target = foot.getWorldPosition(new Vector3());
    const hip = leg.getWorldPosition(new Vector3()), offset = target.clone().sub(hip);
    offset.y = 0; offset.clampLength(0, .65 * skin.profile.height);
    target.x = hip.x + offset.x; target.z = hip.z + offset.z;
    target.y = person.getWorldPosition(new Vector3()).y + .07 * skin.profile.height;
    const beforeLeg = leg.quaternion.clone(), beforeKnee = knee.quaternion.clone();
    const pole = new Vector3(0, 1, -.1).applyQuaternion(facing);
    for (let iteration = 0; iteration < 4; iteration++) {
      if (solveArm(leg, knee, foot, target, pole).error < .002) break;
    }
    leg.quaternion.copy(beforeLeg.slerp(leg.quaternion, weight));
    knee.quaternion.copy(beforeKnee.slerp(knee.quaternion, weight));
    person.updateMatrixWorld(true);
    const rotation = foot.parent.getWorldQuaternion(foot.quaternion.clone()).invert().multiply(facing);
    foot.quaternion.slerp(rotation, weight);
  }
  } finally { visual.scale.x = originalWidth; person.updateMatrixWorld(true); }
  // Only settled poses cache their actual skinned support; transitions are sampled without an unbounded cache.
  let correction = weight === 1 ? state.ground.get(key) : null;
  if (correction == null) {
    person.updateMatrixWorld(true); skin.skeleton.update();
    const positions = skin.mesh.geometry.attributes.position;
    const point = new Vector3(); let minimum = Infinity;
    for (let index = 0; index < positions.count; index++) {
      const y = positions.getY(index), x = positions.getX(index);
      if (!(y < .15 || y > .75 && y < .94 && Math.abs(x) < .19)) continue;
      skin.mesh.getVertexPosition(index, point); skin.mesh.localToWorld(point);
      minimum = Math.min(minimum, point.y);
    }
    if (!Number.isFinite(minimum)) throw new Error('Civilian seated support geometry is missing');
    correction = .012 - (minimum - person.getWorldPosition(new Vector3()).y);
    correction /= skin.profile.height;
    if (weight === 1) state.ground.set(key, correction);
  }
  joints.root.position.y += correction * weight;
  person.updateMatrixWorld(true);
  visual.scale.x = visual.scale.y; person.updateMatrixWorld(true);
  try {
  for (const side of ['left', 'right']) {
    const leg = joints[`${side}Leg`], knee = joints[`${side}Knee`], foot = joints[`${side}Foot`];
    const target = foot.getWorldPosition(new Vector3());
    target.y = person.getWorldPosition(new Vector3()).y + .07 * skin.profile.height;
    const beforeLeg = leg.quaternion.clone(), beforeKnee = knee.quaternion.clone();
    solveArm(leg, knee, foot, target, new Vector3(0, 1, -.1).applyQuaternion(facing));
    leg.quaternion.copy(beforeLeg.slerp(leg.quaternion, weight));
    knee.quaternion.copy(beforeKnee.slerp(knee.quaternion, weight));
    person.updateMatrixWorld(true);
    foot.quaternion.slerp(foot.parent.getWorldQuaternion(foot.quaternion.clone()).invert().multiply(facing), weight);
  }
  person.updateMatrixWorld(true);
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    if (skin.profile.carrying === 'child' || skin.profile.carrying === 'luggage' && side === 'left') continue;
    const target = kneeContact(side, sign);
    const upper = joints[`${side}Arm`], elbow = joints[`${side}Elbow`], palm = state.palms[side];
    const beforeUpper = upper.quaternion.clone(), beforeElbow = elbow.quaternion.clone();
    const solved = solveArm(upper, elbow, palm, target, new Vector3(sign * .25, -.8, -.1).applyQuaternion(facing));
    upper.quaternion.copy(beforeUpper.slerp(upper.quaternion, weight));
    elbow.quaternion.copy(beforeElbow.slerp(elbow.quaternion, weight));
    errors[side] = { reachable: solved.reachable };
  }
  } finally { visual.scale.x = originalWidth; person.updateMatrixWorld(true); }
  for (const side of Object.keys(errors)) {
    const sign = side === 'left' ? -1 : 1;
    const target = kneeContact(side, sign);
    errors[side].error = state.palms[side].getWorldPosition(new Vector3()).distanceTo(target);
  }
  let bodyHeight = null;
  if (weight === 1) {
    skin.skeleton.update();
    const point = new Vector3(); let maximum = -Infinity;
    for (let vertex = 0; vertex < skin.mesh.geometry.attributes.position.count; vertex++) {
      skin.mesh.getVertexPosition(vertex, point); skin.mesh.localToWorld(point);
      maximum = Math.max(maximum, point.y);
    }
    bodyHeight = maximum - person.getWorldPosition(new Vector3()).y;
    if (!Number.isFinite(bodyHeight) || bodyHeight <= 0) throw new Error('Invalid seated civilian body bounds');
  }
  person.userData.seatedContacts = { hugging, weight, hands: errors, supportCorrection: correction, bodyHeight };
  if (weight === 1) state.poses.set(key, { rootY: joints.root.position.y,
    rotations: Object.entries(joints).map(([name, bone]) => [name, bone.quaternion.clone()]),
    contacts: person.userData.seatedContacts });
}

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
  const knees = pose === 3 || pose === 2;
  joints.root.position.y += (-.79 - joints.root.position.y) * weight;
  for (const [index, side] of ['left', 'right'].entries()) {
    blend(joints[`${side}Leg`], 'x', knees ? 2.15 : 1.45);
    blend(joints[`${side}Knee`], 'x', knees ? -2.8 : .05);
    blend(joints[`${side}Foot`], 'x', knees ? .65 : -1.5);
    if (data.carrying === 'child') continue;
    if (data.carrying === 'luggage' && index === 0) {
      blend(joints.leftArm, 'x', -.04); blend(joints.leftElbow, 'x', 1.3);
      continue;
    }
    blend(joints[`${side}Arm`], 'x', pose === 1 ? -.9 : knees ? .2 : .65);
    blend(joints[`${side}Elbow`], 'x', pose === 1 ? .05 : knees ? 1.9 : .7);
    blend(joints[`${side}Arm`], 'z', index ? -.08 : .08);
  }
  blend(joints.torso, 'x', knees ? -.8 : -.45);
  blend(joints.head, 'x', knees ? -.85 : -.12);
  applyCivilianSeatedContacts(person, weight, knees);
}

export function civilianBodyHeight(person) {
  const data = person.userData, weight = data.restPoseWeight ?? 0, pose = data.restPose ?? 0;
  if (!data.boarding && (weight === 1 || data.escapeMotion?.crouch === 1) &&
    data.seatedContacts?.weight === 1 && Number.isFinite(data.seatedContacts.bodyHeight))
    return data.seatedContacts.bodyHeight;
  const drop = .79;
  return (person.civilianSkin?.profile.height ?? 1) *
    (1.72 - (data.escapeMotion?.crouch ?? 0) * .65 * (1 - weight) - drop * weight);
}
