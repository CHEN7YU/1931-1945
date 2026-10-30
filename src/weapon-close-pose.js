import { MathUtils } from 'three';

export const CLOSE_WEAPON_POSE = Object.freeze({ x: .18, y: -.4, z: -.04, pitch: 1.2 });

export function applyCloseWeaponPose(model, blend) {
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) throw new RangeError('Invalid close weapon blend');
  const t = MathUtils.smoothstep(blend, 0, 1);
  model.position.x = MathUtils.lerp(model.position.x, CLOSE_WEAPON_POSE.x, t);
  model.position.y = MathUtils.lerp(model.position.y, CLOSE_WEAPON_POSE.y, t);
  model.position.z = MathUtils.lerp(model.position.z, CLOSE_WEAPON_POSE.z, t);
  model.rotation.x = MathUtils.lerp(model.rotation.x, CLOSE_WEAPON_POSE.pitch, t);
  model.rotation.y *= 1 - t;
  model.rotation.z *= 1 - t;
}
