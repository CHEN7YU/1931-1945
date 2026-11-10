import { blastExposure } from './blast-profiles.js';

export const BLAST_TINNITUS = Object.freeze({
  frequency: 2200, onset: .8, attack: .4, decay: 1.5,
  duration: 4.5, release: .4, recovery: 16, threshold: .25, gain: .035,
});

export function blastTinnitusEnvelope(elapsed) {
  const p = BLAST_TINNITUS, time = elapsed - p.onset;
  if (time <= 0 || elapsed >= p.duration) return 0;
  const onset = Math.min(1, time / p.attack), end = Math.min(1, (p.duration - elapsed) / p.release);
  return p.gain * onset * onset * (3 - 2 * onset) * Math.exp(-time / p.decay) * end * end;
}

export function createBlastTinnitus(context, output) {
  let voice = null, played = 0, nextAllowedAt = 0;
  const reset = () => {
    if (!voice) return;
    const previous = voice;
    voice = null;
    previous.oscillator.stop();
    previous.release();
  };
  const expire = () => { if (voice && context.currentTime >= voice.ends) voice.release(); };
  return {
    play(position, listener, style = 'grenade') {
      if (context.state !== 'running') { reset(); return false; }
      const exposure = blastExposure(position, listener.position, style);
      if (exposure.strength < BLAST_TINNITUS.threshold) return false;
      const at = context.currentTime;
      expire();
      if (voice) {
        if (exposure.strength > voice.strength) {
          voice.strength = exposure.strength;
          voice.level.gain.setTargetAtTime(voice.strength, at, .12);
        }
        return true;
      }
      if (at < nextAllowedAt) return false;
      const { duration, recovery, frequency } = BLAST_TINNITUS;
      const strength = exposure.strength;
      const oscillator = context.createOscillator(), gain = context.createGain(), level = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, at);
      const curve = Float32Array.from({ length: 361 }, (_, i) => blastTinnitusEnvelope(duration * i / 360));
      gain.gain.setValueCurveAtTime(curve, at, duration);
      level.gain.setValueAtTime(strength, at);
      oscillator.connect(gain).connect(level).connect(output);
      let released = false;
      const current = { oscillator, level, ends: at + duration, strength, release() {
        if (released) return;
        released = true;
        oscillator.disconnect(); gain.disconnect(); level.disconnect();
        if (voice === current) voice = null;
      } };
      voice = current; oscillator.onended = current.release;
      // Retain the deadline across pause, death takeover and audio resets; never queue suppressed blasts.
      nextAllowedAt = at + duration + recovery;
      oscillator.start(at); oscillator.stop(at + duration);
      played++;
      return true;
    },
    reset,
    get snapshot() {
      expire();
      return { active: voice ? 1 : 0, limit: 1, played, strength: voice?.strength ?? 0,
        endsAt: voice?.ends ?? null, nextAllowedAt };
    },
  };
}
