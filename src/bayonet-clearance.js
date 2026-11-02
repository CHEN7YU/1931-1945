import { Quaternion, Vector3 } from 'three';
import { circleBlocked } from './core.js';
import { BAYONET } from './bayonet.js';

export function bayonetObstructed(actor, pose, candidatesAt) {
  if (![actor.heading, actor.position.x, actor.position.y, actor.position.z,
    ...pose.weaponPosition, ...pose.weaponQuaternion].every(Number.isFinite) || typeof candidatesAt !== 'function') {
    throw new RangeError('Bayonet clearance requires finite owned transforms and obstacle candidates');
  }
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), actor.heading);
  const weaponRotation = rotation.clone().multiply(new Quaternion().fromArray(pose.weaponQuaternion));
  const origin = new Vector3().fromArray(pose.weaponPosition).applyQuaternion(rotation).add(actor.position);
  const from = new Vector3(0, 0, .38).applyQuaternion(weaponRotation).add(origin);
  const to = new Vector3(0, -.045, BAYONET.tipZ).applyQuaternion(weaponRotation).add(origin);
  const steps = Math.ceil(from.distanceTo(to) / .08);
  const point = new Vector3();
  for (let i = 0; i <= steps; i++) {
    point.copy(from).lerp(to, i / steps);
    if (circleBlocked(point.x, point.z, .08, candidatesAt(point.x, point.z), point.y - .08, .16)) return true;
  }
  return false;
}
