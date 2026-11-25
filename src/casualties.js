import { Quaternion, Vector3 } from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { RIFLE_CONTACTS } from './rifle-contacts.js';
import { casualtyJointDynamics } from './casualty-dynamics.js';
import { finishStartupWork } from './startup-work.js';

export const CORPSE_RULES = Object.freeze({ minimumSeconds: 180, softLimit: 120, variants: 4 });
export const CASUALTY_POSE_FRAMES = 5;
const Y = new Vector3(0, 1, 0);
const PLACEMENT_OFFSETS = Object.freeze([{ x: 0, z: 0 }, ...[.15, .3, .5, .75, 1, 1.5, 2].flatMap(radius =>
  Array.from({ length: 8 }, (_, side) => Object.freeze({
    x: Math.cos(side * Math.PI / 4) * radius, z: Math.sin(side * Math.PI / 4) * radius,
  })))].map(Object.freeze));
const PLACEMENT_RING = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze([
  Math.cos(index * Math.PI / 4) * .22, Math.sin(index * Math.PI / 4) * .22,
])));
const PLACEMENT_PHASES = Object.freeze(Array.from({ length: 8 }, (_, index) => {
  const progress = (index + 1) / 8, grow = Math.sin(progress * Math.PI / 2);
  return Object.freeze({ progress, grow, slide: Math.sqrt(progress), height: 1.85 * (1 - grow) + .75 * grow });
}));
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function corpseFootprint(geometry) {
  return finishStartupWork(corpseFootprintWork(geometry));
}

export function* corpseFootprintWork(geometry) {
  const positions = geometry.attributes.position, indices = geometry.index, cells = new Set(), size = .16;
  if (!positions || positions.itemSize !== 3 || !positions.count || !positions.array.every(Number.isFinite)) {
    throw new Error('Casualty footprint requires finite rendered body geometry');
  }
  for (let at = 0; at < (indices?.count ?? positions.count); at += 3) {
    const points = [0, 1, 2].map(corner => {
      const index = indices ? indices.getX(at + corner) : at + corner;
      return [positions.getX(index), positions.getZ(index)];
    });
    const minX = Math.floor(Math.min(...points.map(point => point[0])) / size);
    const maxX = Math.floor(Math.max(...points.map(point => point[0])) / size);
    const minZ = Math.floor(Math.min(...points.map(point => point[1])) / size);
    const maxZ = Math.floor(Math.max(...points.map(point => point[1])) / size);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) cells.add(`${x},${z}`);
    if ((at + 3) % 384 === 0) yield;
  }
  return Object.freeze([...cells].map(key => Object.freeze(key.split(',').map(value => (Number(value) + .5) * size))));
}

export function placeCasualty(actor, casualty, boundsFor, blocked) {
  if (typeof boundsFor !== 'function' || typeof blocked !== 'function') throw new TypeError('Casualty placement needs body bounds and collision queries');
  const variants = [casualty.variant, ...[0, 1, 2, 3].filter(value => value !== casualty.variant)]
    .filter(value => !(casualty.motion?.prone > .5) || value === 2);
  const offsets = PLACEMENT_OFFSETS;
  const cardinal = Math.round(actor.heading / (Math.PI / 2)) * Math.PI / 2;
  const headings = [actor.heading, cardinal, cardinal + Math.PI / 2];
  // The collision snapshot is fixed for this synchronous search; the ring is independent of the body variant.
  const ringClear = [];
  const shapes = new Map(variants.map(variant => {
    const bounds = boundsFor(variant, casualty.retainGun);
    if (!bounds || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error('Casualty body bounds are invalid');
    const points = bounds.footprint ? [...bounds.footprint] : [];
    if (!bounds.footprint) for (let x = bounds.min[0]; x <= bounds.max[0] + .001; x += Math.min(.18, bounds.max[0] - x || .18)) {
      for (let z = bounds.min[2]; z <= bounds.max[2] + .001; z += Math.min(.18, bounds.max[2] - z || .18)) points.push([x, z]);
    }
    return [variant, points];
  }));
  for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex++) for (const variant of variants) for (let headingIndex = 0; headingIndex < headings.length; headingIndex++) {
    const offset = offsets[offsetIndex], heading = headings[headingIndex];
    const yaw = Math.atan2(Math.sin(heading - actor.heading), Math.cos(heading - actor.heading));
    let clear = true;
    for (let phase = 0; phase < PLACEMENT_PHASES.length && clear; phase++) {
      const { progress, grow, slide, height } = PLACEMENT_PHASES[phase];
      const angle = actor.heading + yaw * progress, c = Math.cos(angle), s = Math.sin(angle);
      const points = shapes.get(variant);
      const baseX = actor.position.x + offset.x * slide;
      const baseZ = actor.position.z + offset.z * slide;
      const ring = (ringClear[offsetIndex] ??= [])[headingIndex] ??= [];
      if (ring[phase] === undefined) {
        ring[phase] = true;
        for (const [x, z] of PLACEMENT_RING) {
          const hit = blocked({ x: baseX + x * c + z * s, y: actor.position.y, z: baseZ - x * s + z * c }, .13, height);
          if (typeof hit !== 'boolean') throw new TypeError('Casualty collision query must return a boolean');
          if (hit) { ring[phase] = false; break; }
        }
      }
      if (!ring[phase]) { clear = false; break; }
      for (let index = 0; index < points.length; index++) {
        const x = points[index][0] * grow, z = points[index][1] * grow;
        const hit = blocked({ x: baseX + x * c + z * s, y: actor.position.y, z: baseZ - x * s + z * c }, .13, height);
        if (typeof hit !== 'boolean') throw new TypeError('Casualty collision query must return a boolean');
        if (hit) { clear = false; break; }
      }
    }
    if (clear) return Object.freeze({ ...casualty, variant, yaw, offset: Object.freeze(offset), wallLimited: false });
  }
  const variant = casualty.motion?.prone > .5 ? 2 : 3;
  const compact = boundsFor(variant, false);
  const points = compact.footprint ?? [[compact.min[0], compact.min[2]], [compact.max[0], compact.max[2]], [0, 0]];
  const compactHeadings = [actor.heading, cardinal, cardinal + Math.PI / 2, cardinal + Math.PI, cardinal - Math.PI / 2];
  const rotated = [];
  let best = null;
  for (const offset of offsets) {
    const distance = Math.hypot(offset.x, offset.z);
    if (best && distance >= best.score) continue;
    for (let headingIndex = 0; headingIndex < compactHeadings.length; headingIndex++) {
      if (best && distance >= best.score) break;
      const heading = compactHeadings[headingIndex];
      if (!rotated[headingIndex]) {
        // Keep the four products separate to preserve collision coordinates at rounding boundaries.
        const c = Math.cos(heading), s = Math.sin(heading), values = new Float64Array(points.length * 4);
        for (let index = 0; index < points.length; index++) {
          const [x, z] = points[index], at = index * 4;
          values[at] = x * c; values[at + 1] = z * s;
          values[at + 2] = x * s; values[at + 3] = z * c;
        }
        rotated[headingIndex] = values;
      }
      const values = rotated[headingIndex], baseX = actor.position.x + offset.x, baseZ = actor.position.z + offset.z;
      let contacts = 0;
      for (let index = 0; index < values.length; index += 4) {
        const hit = blocked({ x: baseX + values[index] + values[index + 1], y: actor.position.y,
          z: baseZ - values[index + 2] + values[index + 3] }, .13, .75);
        if (typeof hit !== 'boolean') throw new TypeError('Casualty collision query must return a boolean');
        contacts += Number(hit);
        if (best && contacts * 100 + distance >= best.score) break;
      }
      const score = contacts * 100 + distance;
      if (!best || score < best.score) best = { score, contacts, offset, yaw: Math.atan2(Math.sin(heading - actor.heading), Math.cos(heading - actor.heading)) };
    }
  }
  return Object.freeze({ ...casualty, variant, retainGun: false, yaw: best.yaw,
    offset: Object.freeze(best.offset), wallLimited: true });
}

function seedFor(id) {
  if (typeof id !== 'string' || !id) throw new Error('Casualty requires an original soldier identity');
  let seed = 2166136261;
  for (const letter of id) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  return seed;
}

export function createCasualtyState(actor, now, motion = null, options = {}) {
  if (!Number.isFinite(actor?.health) || actor.health > 0 || !Number.isFinite(now) || now < 0 ||
    !['x', 'y', 'z'].every(axis => Number.isFinite(actor.position?.[axis])) ||
    !Number.isFinite(actor.heading)) throw new Error('Casualty requires a dead soldier and finite simulation pose');
  const seed = seedFor(actor.id), impact = actor.lastHit?.direction;
  if (impact && ![impact.x, impact.z].every(Number.isFinite)) throw new RangeError('Casualty impact direction must be finite');
  let preferred = seed % CORPSE_RULES.variants;
  if (impact && Math.hypot(impact.x, impact.z) > .001) {
    const c = Math.cos(actor.heading), s = Math.sin(actor.heading);
    const x = impact.x * c - impact.z * s, z = impact.x * s + impact.z * c;
    preferred = Math.abs(x) > Math.abs(z) ? x < 0 ? 0 : 1 : z < 0 ? 2 : 3;
  }
  if (motion?.speed > 2.5 && !actor.lastHit?.blast) preferred = 2;
  if (motion?.prone > .5) preferred = 2;
  const variant = options.variant ?? preferred;
  const retainGun = options.retainGun ?? (seed >>> 4) % 3 === 0;
  const drop = options.drop ?? [variant % 2 ? .65 : -.65, .05, -.25 + (seed >>> 20) % 50 / 100];
  if (!Number.isInteger(variant) || variant < 0 || variant >= CORPSE_RULES.variants || typeof retainGun !== 'boolean' ||
    !Array.isArray(drop) || drop.length !== 3 || !drop.every(Number.isFinite)) {
    throw new Error('Invalid casualty pose variation');
  }
  return Object.freeze({ time: now, variant, retainGun, duration: 1.1 + (seed >>> 8) % 40 / 100,
    fold: .35 + (seed >>> 16) % 40 / 100, motion, hitZone: actor.lastHit?.hitZone ?? null,
    drop: Object.freeze([...drop]) });
}

export function expiredCorpses(actors, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Corpse retention requires finite simulation time');
  const ordered = [...actors];
  if (ordered.some(actor => actor.health > 0 || !Number.isFinite(actor.casualty?.time) || actor.casualty.time > now)) {
    throw new Error('Corpse collection contains a living or invalid casualty');
  }
  ordered.sort((a, b) => a.casualty.time - b.casualty.time || a.id.localeCompare(b.id));
  return ordered.filter(actor => now - actor.casualty.time >= CORPSE_RULES.minimumSeconds)
    .slice(0, Math.max(0, ordered.length - CORPSE_RULES.softLimit));
}

export function casualtyProgress(casualty, now) {
  if (!casualty || !Number.isFinite(now) || !Number.isFinite(casualty.time) ||
    !Number.isFinite(casualty.duration) || casualty.duration <= 0 || now < casualty.time)
    throw new Error('Invalid casualty presentation time');
  const t = Math.min(1, (now - casualty.time) / casualty.duration);
  return t * t * (3 - 2 * t);
}

export function sampleCasualtyMotion(casualty, now) {
  const motion = casualty.motion;
  if (!motion) return motion;
  const response = casualtyResponse(casualty, now);
  if (casualty.variant !== 3 || !casualty.wallLimited || motion.prone > .5) return { ...motion,
    weight: motion.weight * (1 - response.relax), speed: motion.speed * (1 - response.relax),
    bodyLean: motion.bodyLean * (1 - response.relax),
    headAim: motion.headAim ? { ...motion.headAim, weight: motion.headAim.weight * (1 - response.relax) } : null };
  const progress = casualtyProgress(casualty, now), remaining = 1 - progress;
  const postures = Object.fromEntries(Object.entries(motion.postures).map(([name, weight]) =>
    [name, weight * remaining + (name === 'kneeling' ? progress : 0)]));
  return { ...motion, ...postures, postures, upright: motion.upright * remaining,
    bodyLean: motion.bodyLean * remaining, hipDrop: motion.hipDrop * remaining,
    weight: motion.weight * remaining, headAim: progress ? null : motion.headAim };
}

export function casualtyResponse(casualty, now) {
  casualtyProgress(casualty, now);
  const elapsed = Math.min(1, (now - casualty.time) / casualty.duration);
  const prone = casualty.motion?.prone ?? 0;
  const buckle = Math.sin(Math.PI * smooth(0, .8, elapsed)) * (1 - prone);
  return { elapsed, buckle, fall: smooth(.12, .9, elapsed),
    relax: smooth(.08, .95, elapsed), arms: smooth(.1, .9, elapsed),
    settle: Math.sin(Math.PI * smooth(.8, 1, elapsed)) * .035,
    drop: buckle * (.24 + Math.min(4.8, casualty.motion?.speed ?? 0) * .02) };
}

export function casualtyRotation(casualty, progress) {
  const axes = [[0, 0, 1], [0, 0, -1], [-1, 0, 0], [1, 0, 0]];
  const axis = casualty.wallLimited && casualty.variant === 3 ? axes[0] : axes[casualty.variant];
  return new Quaternion().setFromAxisAngle(new Vector3(...axis), Math.PI / 2 * progress);
}

export function createCasualtyPose(root, bones, gun, groundAt) {
  const points = ['Hips', 'Spine', 'Spine2', 'Head', 'HeadTop_End',
    ...['Left', 'Right'].flatMap(side => ['Hand', 'ForeArm', 'Leg', 'Foot'].map(name => side + name))];
  if (points.some(name => !bones.has(name)) || typeof groundAt !== 'function') throw new Error('Casualty pose requires inspected body joints and ground');
  const fingerNames = [...bones.keys()].filter(name => /Hand(?:Thumb|Index|Middle|Ring|Pinky)[123]$/.test(name));
  const rest = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
  root.updateMatrixWorld(true);
  const hinges = new Map(['Left', 'Right'].flatMap(side => ['UpLeg', 'Leg', 'Foot'].map(part => {
    const name = side + part;
    return [name, new Vector3(1, 0, 0).transformDirection(root.matrixWorld)
      .applyQuaternion(bones.get(name).getWorldQuaternion(new Quaternion()).invert())];
  })));
  const rotate = (name, x, y, z, weight) => {
    const bone = bones.get(name);
    bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), weight));
  };
  return (actor, now) => {
    const c = actor.casualty, progress = casualtyProgress(c, now), response = casualtyResponse(c, now);
    const dynamics=casualtyJointDynamics(c,now);
    if (progress === 0) return { variant: c.variant, retainGun: c.retainGun, progress, settled: false,
      gunPosition: gun.getWorldPosition(new Vector3()).toArray() };
    const startGun = gun.position.clone(), startRotation = gun.quaternion.clone();
    root.updateMatrixWorld(true);
    const pivot = root.worldToLocal(bones.get('Hips').getWorldPosition(new Vector3()));
    const prone = c.motion?.prone ?? 0;
    const fall = casualtyRotation(c, response.fall * (1 - .85 * prone));
    if (c.blastRoll) fall.multiply(new Quaternion().setFromAxisAngle(Y, c.blastRoll));
    const facing = new Quaternion().setFromAxisAngle(Y, actor.heading + (c.yaw ?? 0) * progress);
    root.quaternion.copy(facing).multiply(fall);
    root.position.copy(actor.position).add(pivot.clone().sub(pivot.clone().applyQuaternion(fall)).applyQuaternion(facing));
    root.position.x += (c.offset?.x ?? 0) * Math.sqrt(progress);
    root.position.z += (c.offset?.z ?? 0) * Math.sqrt(progress);
    root.position.y -= response.drop * (1.3 + .3*dynamics.pelvis) + response.settle;
    for (const [index, side] of ['Left', 'Right'].entries()) {
      if (c.variant === 3 && c.wallLimited && !(c.motion?.prone > .5)) continue;
      const joint=index?dynamics.rightKnee:dynamics.leftKnee;
      const drive = Math.sin(Math.PI * (c.recovery ?? 0));
      const hip = (index ? .16 : .32) + c.fold * .2 + drive * (index ? .25 : .55);
      const knee = (index ? .65 : 1.05) + c.fold * .3 + drive * (index ? .35 : .65);
      for (const [part, bend] of [['UpLeg', -hip * (prone > .5 ? .35 : 1) - response.buckle * .65*joint],
        ['Leg', knee * (prone > .5 ? .6 : 1) +
          response.buckle * (c.hitZone === 'limb' ? 1.1 : .85)*joint],
        ['Foot', -.12 - response.buckle * .25*joint]]) {
        const name = side + part;
        bones.get(name).quaternion.slerp(rest.get(name).clone()
          .multiply(new Quaternion().setFromAxisAngle(hinges.get(name), bend)), Math.max(response.relax, response.buckle));
      }
    }
    for (const name of ['Spine', 'Neck', 'Head']) {
      if (bones.has(name)) bones.get(name).quaternion.slerp(rest.get(name), response.relax);
    }
    rotate('Spine', 1, 0, 0, response.buckle * .58*dynamics.chest);
    rotate('Spine', 0, 1, 0, dynamics.twist * response.relax);
    rotate('Spine', 0, 0, 1, dynamics.twist * .65*dynamics.chest*(1-prone*.8));
    rotate('Head', 1, 0, 0, .25 * dynamics.head*(1-prone*.6));
    rotate('Head', 0, 0, 1, -dynamics.twist * dynamics.head);
    for (const name of fingerNames) {
      if (c.retainGun && name.startsWith('Right')) continue;
      const bone = bones.get(name);
      bone.quaternion.slerp(rest.get(name), .85 * response.arms);
    }
    root.updateMatrixWorld(true);
    let correction = -Infinity;
    for (const name of points.filter(name => !/Hand|ForeArm/.test(name))) {
      const p = bones.get(name).getWorldPosition(new Vector3());
      const radius = name === 'Hips' ? .14 : name === 'Head' ? .12 : name === 'Spine2' ? .13 : .045;
      correction = Math.max(correction, groundAt(p.x, p.z, actor.position.y) + radius - p.y);
    }
    for (const side of ['Left', 'Right']) {
      const p = bones.get(side + 'Arm').getWorldPosition(new Vector3());
      correction = Math.max(correction, groundAt(p.x, p.z, actor.position.y) + .065 - p.y);
    }
    root.position.y += correction > 0 ? correction : correction * response.fall;
    root.updateMatrixWorld(true);
    const hips = bones.get('Hips').getWorldPosition(new Vector3()), along = bones.get('Neck').getWorldPosition(new Vector3()).sub(hips);
    along.y = 0;
    if (along.lengthSq() < 1e-8) along.set(0, 0, -1).applyQuaternion(facing);
    along.normalize();
    const across = Y.clone().cross(along).normalize();
    for (const [index, side] of ['Left', 'Right'].entries()) {
      const upper = bones.get(side + 'Arm'), lower = bones.get(side + 'ForeArm'), hand = bones.get(side + 'Hand');
      const beforeUpper = upper.quaternion.clone(), beforeLower = lower.quaternion.clone();
      const origin = upper.getWorldPosition(new Vector3()), elbow = lower.getWorldPosition(new Vector3()), wrist = hand.getWorldPosition(new Vector3());
      const held = c.retainGun && side === 'Right', sign = index ? 1 : -1;
      const armResponse=Math.min(1,index?dynamics.rightArm:dynamics.leftArm);
      const bracing = !held && c.recovery > 0 ? Math.sin(Math.PI * c.recovery) : 0;
      const target = hips.clone().addScaledVector(along, (index ? .20 : .42) + c.fold * .08 + bracing * .1)
        .addScaledVector(across, sign * (c.wallLimited ? .18 : held ? .20 : index ? .32 : .40));
      target.y = groundAt(target.x, target.z, actor.position.y) + (held ? .12 : .07);
      const a = origin.distanceTo(elbow), b = elbow.distanceTo(wrist);
      const delta = target.sub(origin).clampLength(Math.abs(origin.distanceTo(elbow) - elbow.distanceTo(wrist)) + .005,
        (a + b) * .88);
      const distance = delta.length(), direction = delta.clone().normalize();
      const reach = (a * a - b * b + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, a * a - reach * reach));
      const center = origin.clone().addScaledVector(direction, reach);
      const vertical = Y.clone().addScaledVector(direction, -direction.y);
      const pole = across.clone().multiplyScalar(sign);
      if (vertical.lengthSq() > 1e-8 && height > 1e-6) {
        vertical.normalize();
        const horizontal = direction.clone().cross(vertical);
        if (horizontal.dot(pole) < 0) horizontal.negate();
        const floor = groundAt(center.x, center.z, actor.position.y) + .065 + bracing * .12;
        const amount = Math.max(-1, Math.min(1, (floor - center.y) / (height * vertical.y)));
        pole.copy(vertical).multiplyScalar(amount).addScaledVector(horizontal, Math.sqrt(1 - amount * amount));
      }
      solveArm(upper, lower, hand, delta.add(origin), pole);
      upper.quaternion.copy(beforeUpper.slerp(upper.quaternion, armResponse));
      lower.quaternion.copy(beforeLower.slerp(lower.quaternion, armResponse));
      root.updateMatrixWorld(true);
    }
    if (c.retainGun) {
      const right = bones.get('RightHand').getWorldPosition(new Vector3()).lerp(bones.get('RightHandMiddle1').getWorldPosition(new Vector3()), .55);
      const target = root.getWorldQuaternion(new Quaternion()).invert().multiply(facing)
        .multiply(new Quaternion().setFromAxisAngle(Y, c.variant * .7))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
      gun.quaternion.copy(startRotation).slerp(target, progress);
      gun.position.copy(root.worldToLocal(right)).sub(new Vector3(...RIFLE_CONTACTS.triggerPalm).applyQuaternion(gun.quaternion));
    } else {
      const world = new Vector3(...c.drop).applyQuaternion(facing).add(actor.position);
      world.x += (c.offset?.x ?? 0) * Math.sqrt(progress); world.z += (c.offset?.z ?? 0) * Math.sqrt(progress);
      world.y = groundAt(world.x, world.z, actor.position.y) + .05;
      root.worldToLocal(world);
      gun.position.copy(startGun).lerp(world, progress);
      gun.quaternion.copy(startRotation).slerp(root.getWorldQuaternion(new Quaternion()).invert()
        .multiply(facing).multiply(new Quaternion().setFromAxisAngle(Y, c.variant * .7))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)), progress);
    }
    root.updateMatrixWorld(true);
    {
      let minimum = Infinity;
      gun.traverseVisible(mesh => {
        if (!mesh.isMesh || mesh.userData.rifleAttachment) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = mesh.localToWorld(new Vector3(x, y, z));
          minimum = Math.min(minimum, point.y - groundAt(point.x, point.z, actor.position.y));
        }
      });
      if (Number.isFinite(minimum)) {
        const correction = (.012 - minimum) * progress;
        if (c.retainGun) root.position.y += Math.max(0, correction);
        else {
          const position = gun.getWorldPosition(new Vector3()); position.y += correction;
          gun.position.copy(root.worldToLocal(position));
        }
        root.updateMatrixWorld(true);
      }
    }
    return { variant: c.variant, retainGun: c.retainGun, progress, settled: progress === 1,
      gunPosition: gun.getWorldPosition(new Vector3()).toArray() };
  };
}
