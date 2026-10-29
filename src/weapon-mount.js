export const WEAPON_MOUNT = Object.freeze({
  reach: .62, maxReach: .9, probeDepth: .9, maxEyeOffset: .5, sightAboveSupport: .16,
  yawLimit: Math.PI / 5, pitchLimit: Math.PI / 9, settleSeconds: .2,
  swayScale: .2, recoilScale: .3, machineGunRecoilScale: .2,
});
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

export function createWeaponMount() {
  return { active: false, blend: 0, contact: null, origin: null, yaw: 0, pitch: 0, stance: null, eyeOffset: 0 };
}

export function mountCandidate(position, eyeHeight, yaw, probe) {
  let candidate = null;
  for (const reach of [WEAPON_MOUNT.reach, .76, WEAPON_MOUNT.maxReach]) {
    const point = { x: position.x - Math.sin(yaw) * reach,
      y: position.y + eyeHeight + .15, z: position.z - Math.cos(yaw) * reach };
    const contact = probe(point, WEAPON_MOUNT.probeDepth);
    if (!contact || ![contact.x, contact.y, contact.z, contact.normalY].every(Number.isFinite) || contact.normalY < .7) continue;
    const eyeOffset = contact.y + WEAPON_MOUNT.sightAboveSupport - position.y - eyeHeight;
    if (Math.abs(eyeOffset) > WEAPON_MOUNT.maxEyeOffset) continue;
    if (!candidate || Math.abs(eyeOffset) < Math.abs(candidate.eyeOffset)) candidate = { contact, eyeOffset };
  }
  return candidate;
}

export function beginWeaponMount(state, candidate, position, yaw, pitch, stance) {
  Object.assign(state, { active: true, blend: 0, contact: { ...candidate.contact },
    origin: { x: position.x, y: position.y, z: position.z }, yaw, pitch, stance, eyeOffset: candidate.eyeOffset });
}

export function releaseWeaponMount(state) {
  state.active = false;
}

export function advanceWeaponMount(state, dt, position, stance, available, probe) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Weapon support requires finite non-negative time');
  if (state.active) {
    const contact = probe({ x: state.contact.x, y: state.contact.y + .15, z: state.contact.z }, .3);
    if (!available || stance !== state.stance || Math.hypot(position.x - state.origin.x,
      position.y - state.origin.y, position.z - state.origin.z) > .08 ||
      !contact || contact.normalY < .7 || Math.abs(contact.y - state.contact.y) > .04) releaseWeaponMount(state);
  }
  state.blend = Math.max(0, Math.min(1, state.blend + dt / WEAPON_MOUNT.settleSeconds * (state.active ? 1 : -1)));
}

export function mountedLook(state, yaw, pitch) {
  if (!state.active) return { yaw, pitch };
  return { yaw: state.yaw + clamp(angleDelta(yaw, state.yaw), WEAPON_MOUNT.yawLimit),
    pitch: state.pitch + clamp(pitch - state.pitch, WEAPON_MOUNT.pitchLimit) };
}

export function mountStability(state, automatic = false) {
  const blend = state.active ? state.blend : 0;
  return { sway: 1 - blend * (1 - WEAPON_MOUNT.swayScale),
    recoil: 1 - blend * (1 - (automatic ? WEAPON_MOUNT.machineGunRecoilScale : WEAPON_MOUNT.recoilScale)) };
}
