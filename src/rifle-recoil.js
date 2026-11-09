import { infantryWeaponProfile } from './rifle-action.js';

const STANCE = Object.freeze({ standing: 1, crouched: .78, kneeling: .75, prone: .55, wallLeft: .85, wallRight: .85 });
const envelope = (age, peak) => age <= 0 || age >= .3 ? 0 : age / peak * Math.exp(1 - age / peak);
const bounded = (value, limit) => Math.max(-limit, Math.min(limit, value));

export function createRifleRecoil() {
  let shots = [], serial = 0;
  return {
    shot(time, { model = 'rifle', stance = 'standing', aiming = false, support = 1 } = {}) {
      const profile = infantryWeaponProfile({ model });
      if (!Number.isFinite(time) || time < 0 || !Object.hasOwn(STANCE, stance) ||
        typeof aiming !== 'boolean' || !Number.isFinite(support) || support < 0 || support > 1)
        throw new RangeError('Rifle recoil requires a finite shot and supported firing stance');
      const strength = (profile.smg ? .24 : profile.automatic ? .42 : 1) * STANCE[stance] * support;
      shots = shots.filter(shot => time >= shot.time && time - shot.time < .3);
      shots.push({ time, strength, camera: aiming ? profile.scoped ? .42 : .8 : 1,
        weapon: aiming ? .85 : 1, side: ++serial % 2 ? 1 : -1 });
      if (shots.length > 8) shots.shift();
    },
    sample(time) {
      if (!Number.isFinite(time) || time < 0) throw new RangeError('Rifle recoil requires finite simulation time');
      shots = shots.filter(shot => time >= shot.time && time - shot.time < .3);
      let pitch = 0, yaw = 0, weaponPitch = 0, weaponYaw = 0, rear = 0;
      for (const shot of shots) {
        const age = time - shot.time, camera = envelope(age, .018) * shot.strength * shot.camera;
        const weapon = envelope(age, .028) * shot.strength * shot.weapon;
        pitch += .05 * camera; yaw += .0025 * camera * shot.side;
        weaponPitch += .07 * weapon; weaponYaw += .004 * weapon * shot.side; rear += .045 * weapon;
      }
      return { pitch: bounded(pitch, .075), yaw: bounded(yaw, .008),
        weaponPitch: bounded(weaponPitch, .1), weaponYaw: bounded(weaponYaw, .012), rear: Math.min(rear, .06) };
    },
    clear() { shots = []; serial = 0; },
  };
}
