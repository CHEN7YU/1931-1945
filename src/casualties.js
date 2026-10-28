import { Quaternion, Vector3 } from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { RIFLE_CONTACTS } from './rifle-contacts.js';

export const CORPSE_RULES = Object.freeze({ minimumSeconds: 180, softLimit: 120, variants: 4 });
const Y = new Vector3(0, 1, 0);

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
  const seed = seedFor(actor.id), variant = options.variant ?? seed % CORPSE_RULES.variants;
  const retainGun = options.retainGun ?? (seed >>> 4) % 3 === 0;
  const drop = options.drop ?? [variant % 2 ? .65 : -.65, .05, -.25 + (seed >>> 20) % 50 / 100];
  if (!Number.isInteger(variant) || variant < 0 || variant >= CORPSE_RULES.variants || typeof retainGun !== 'boolean' ||
    !Array.isArray(drop) || drop.length !== 3 || !drop.every(Number.isFinite)) {
    throw new Error('Invalid casualty pose variation');
  }
  return Object.freeze({ time: now, variant, retainGun, duration: .85 + (seed >>> 8) % 40 / 100,
    fold: .35 + (seed >>> 16) % 40 / 100, motion,
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
  if (!casualty || !Number.isFinite(now) || now < casualty.time) throw new Error('Invalid casualty presentation time');
  const t = Math.min(1, (now - casualty.time) / casualty.duration);
  return t * t * (3 - 2 * t);
}

export function casualtyRotation(casualty, progress) {
  const axes = [[0, 0, 1], [0, 0, -1], [-1, 0, 0], [1, 0, 0]];
  return new Quaternion().setFromAxisAngle(new Vector3(...axes[casualty.variant]), Math.PI / 2 * progress);
}

export function createCasualtyPose(root, bones, gun, groundAt) {
  const points = ['Hips', 'Spine', 'Spine2', 'Head', 'HeadTop_End',
    ...['Left', 'Right'].flatMap(side => ['Hand', 'ForeArm', 'Leg', 'Foot'].map(name => side + name))];
  if (points.some(name => !bones.has(name)) || typeof groundAt !== 'function') throw new Error('Casualty pose requires inspected body joints and ground');
  const fingerNames = [...bones.keys()].filter(name => /Hand(?:Thumb|Index|Middle|Ring|Pinky)[123]$/.test(name));
  const rest = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
  const rotate = (name, x, y, z, weight) => {
    const bone = bones.get(name);
    bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), weight));
  };
  return (actor, now) => {
    const c = actor.casualty, progress = casualtyProgress(c, now);
    if (progress === 0) return { variant: c.variant, retainGun: c.retainGun, progress, settled: false,
      gunPosition: gun.getWorldPosition(new Vector3()).toArray() };
    const startGun = gun.position.clone(), startRotation = gun.quaternion.clone();
    root.updateMatrixWorld(true);
    const pivot = root.worldToLocal(bones.get('Hips').getWorldPosition(new Vector3()));
    const prone = c.motion?.prone ?? 0;
    const fall = casualtyRotation(c, progress * (1 - .85 * prone));
    const facing = new Quaternion().setFromAxisAngle(Y, actor.heading);
    root.quaternion.copy(facing).multiply(fall);
    root.position.copy(actor.position).add(pivot.clone().sub(pivot.clone().applyQuaternion(fall)).applyQuaternion(facing));
    for (const [index, side] of ['Left', 'Right'].entries()) {
      const sign = index ? 1 : -1;
      for (const [part, bend] of [['UpLeg', sign * .15 * c.fold], ['Leg', (index ? .3 : .65) * c.fold], ['Foot', .1]]) {
        const name = side + part;
        bones.get(name).quaternion.slerp(rest.get(name).clone()
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bend)), progress);
      }
    }
    rotate('Spine', 0, 1, 0, (c.variant % 2 ? -.16 : .16) * progress);
    rotate('Head', 0, 0, 1, (c.variant % 2 ? .15 : -.15) * progress);
    for (const name of fingerNames) {
      if (c.retainGun && name.startsWith('Right')) continue;
      const bone = bones.get(name);
      bone.quaternion.slerp(rest.get(name), .85 * progress);
    }
    root.updateMatrixWorld(true);
    let correction = -Infinity;
    for (const name of points.filter(name => !/Hand|ForeArm/.test(name))) {
      const p = bones.get(name).getWorldPosition(new Vector3());
      const radius = name === 'Hips' ? .14 : name === 'Head' ? .12 : name === 'Spine2' ? .13 : .045;
      correction = Math.max(correction, groundAt(p.x, p.z) + radius - p.y);
    }
    root.position.y += correction * progress;
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
      const target = hips.clone().addScaledVector(along, .12 + c.fold * .15)
        .addScaledVector(across, sign * (held ? .18 : .35 + c.fold * .12));
      target.y = groundAt(target.x, target.z) + (held ? .12 : .07);
      const delta = target.sub(origin).clampLength(Math.abs(origin.distanceTo(elbow) - elbow.distanceTo(wrist)) + .005,
        origin.distanceTo(elbow) + elbow.distanceTo(wrist) - .005);
      solveArm(upper, lower, hand, delta.add(origin), across.clone().multiplyScalar(sign).addScaledVector(Y, .4));
      upper.quaternion.copy(beforeUpper.slerp(upper.quaternion, progress));
      lower.quaternion.copy(beforeLower.slerp(lower.quaternion, progress));
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
      world.y = groundAt(world.x, world.z) + .05;
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
          minimum = Math.min(minimum, point.y - groundAt(point.x, point.z));
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
