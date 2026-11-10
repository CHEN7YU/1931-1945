import { blastExposure } from './blast-profiles.js';

// A single retriggerable envelope: no camera drift and no event-sized allocation pool.
export function createBlastFeedback() {
  let strength = 0, elapsed = 0, duration = 0, flash = 0;
  const clear = () => { strength = elapsed = duration = flash = 0; };
  return {
    trigger(position, listener, style = 'grenade') {
      const exposure = blastExposure(position, listener, style);
      if (exposure.strength <= 0) return exposure;
      const remaining = duration > 0 ? strength * Math.max(0, 1 - elapsed / duration) ** 2 : 0;
      strength = Math.min(1, Math.max(remaining, exposure.strength));
      flash = Math.max(flash * Math.max(0, 1 - elapsed / .22), exposure.flash);
      duration = Math.max(0, duration - elapsed, exposure.duration); elapsed = 0;
      return exposure;
    },
    update(dt, motionStrength = 1) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(motionStrength) || motionStrength < 0 || motionStrength > 1) {
        throw new RangeError('Blast feedback requires finite timestep and motion preference in [0,1]');
      }
      elapsed += dt;
      const envelope = duration > 0 ? Math.max(0, 1 - elapsed / duration) ** 2 : 0;
      const amplitude = strength * envelope * motionStrength;
      const phase = elapsed * 78;
      const sample = { x: Math.sin(phase) * .065 * amplitude, y: Math.sin(phase * 1.31) * .045 * amplitude,
        pitch: Math.sin(phase * .87) * .018 * amplitude, yaw: Math.sin(phase * 1.13) * .012 * amplitude,
        roll: Math.sin(phase * .73) * .024 * amplitude,
        flash: flash * Math.max(0, 1 - elapsed / .22), strength: strength * envelope };
      if (elapsed >= duration) clear();
      return sample;
    },
    reset: clear,
    get snapshot() { return { strength, elapsed, duration, flash }; },
  };
}
