import { blastExposure } from './blast-profiles.js';

export function createBlastTinnitus(context, output) {
  let voice = null, played = 0;
  const reset = () => {
    if (!voice) return;
    const previous = voice;
    voice = null;
    previous.oscillator.stop();
    previous.release();
  };
  return {
    play(position, listener, style = 'grenade') {
      if (context.state !== 'running') { reset(); return false; }
      const exposure = blastExposure(position, listener.position, style);
      if (exposure.strength < .015) return false;
      const at = context.currentTime;
      const residual = voice ? voice.strength * Math.max(0, 1 - (at - voice.started) / voice.duration) ** 2 : 0;
      const strength = Math.min(1, Math.max(residual, exposure.strength));
      const duration = Math.max(exposure.ringing, voice ? voice.duration - (at - voice.started) : 0);
      reset();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(3100, at);
      oscillator.frequency.exponentialRampToValueAtTime(2400, at + duration);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.linearRampToValueAtTime(.045 * strength, at + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(gain).connect(output);
      let released = false;
      const current = { oscillator, started: at, duration, strength, release() {
        if (released) return;
        released = true;
        oscillator.disconnect(); gain.disconnect();
        if (voice === current) voice = null;
      } };
      voice = current; oscillator.onended = current.release;
      oscillator.start(at); oscillator.stop(at + duration + .05);
      played++;
      return true;
    },
    reset,
    get snapshot() { return { active: voice ? 1 : 0, limit: 1, played, strength: voice?.strength ?? 0 }; },
  };
}
