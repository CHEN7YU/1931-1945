import { rifleMix } from './rifle-audio.js';
import { blastExposure, blastProfile } from './blast-profiles.js';
import { createBlastTinnitus } from './blast-tinnitus.js';

export const GRENADE_BLAST_VOICES = 3;
export function grenadeBlastMix(position, listener, style = 'grenade') {
  const mix = rifleMix(position, listener);
  const profile = blastProfile(style);
  return { ...mix, gain: Math.min(1, mix.gain * (profile ? profile.scale / 1.65 : 1)) * Math.max(0, Math.min(1, (150 - mix.distance) / 35)),
    ...blastExposure(position, listener.position, style) };
}

export function createGrenadeBlastAudio(context, noise, output, tinnitusOutput = output) {
  const voices = new Set();
  const tinnitus = createBlastTinnitus(context, tinnitusOutput);
  let played = 0, peak = 0;
  return {
    play(position, listener, style = 'grenade') {
      if (context.state !== 'running') { this.reset(); return false; }
      const mix = grenadeBlastMix(position, listener, style);
      if (mix.distance >= 150) return false;
      tinnitus.play(position, listener, style);
      if (voices.size >= GRENADE_BLAST_VOICES) {
        const weakest = [...voices].reduce((a, b) => a.gain < b.gain ? a : b);
        if (weakest.gain >= mix.gain) return false;
        weakest.stop();
      }
      const at = context.currentTime, source = context.createBufferSource(), filter = context.createBiquadFilter();
      const gain = context.createGain(), body = context.createOscillator(), bodyGain = context.createGain();
      const pan = context.createStereoPanner();
      source.buffer = noise; filter.type = 'lowpass'; pan.pan.value = mix.pan;
      filter.frequency.setValueAtTime(1900, at);
      filter.frequency.exponentialRampToValueAtTime(340, at + .35);
      gain.gain.setValueAtTime(.001, at);
      gain.gain.linearRampToValueAtTime(.65 * mix.gain, at + .006);
      const bodyDuration = .72 + (blastProfile(style)?.impulse ?? .42) * .25;
      gain.gain.exponentialRampToValueAtTime(.001, at + bodyDuration);
      body.type = 'sine'; body.frequency.setValueAtTime(105, at);
      body.frequency.exponentialRampToValueAtTime(38, at + .3);
      bodyGain.gain.setValueAtTime(.22 * mix.gain, at);
      bodyGain.gain.exponentialRampToValueAtTime(.001, at + .6);
      source.connect(filter).connect(gain).connect(pan);
      body.connect(bodyGain).connect(pan); pan.connect(output);
      let released = false;
      const voice = { gain: mix.gain, stop() { source.stop(); body.stop(); voice.release(); }, release() {
        if (released) return;
        released = true; voices.delete(voice);
        for (const node of [source, filter, gain, body, bodyGain, pan]) node.disconnect();
      } };
      source.onended = voice.release; voices.add(voice);
      source.start(at); source.stop(at + bodyDuration + .04); body.start(at); body.stop(at + .65);
      played++; peak = Math.max(peak, voices.size); return true;
    },
    reset() { for (const voice of [...voices]) voice.stop(); tinnitus.reset(); },
    get snapshot() { return { active: voices.size, played, peak, limit: GRENADE_BLAST_VOICES, tinnitus: tinnitus.snapshot }; },
  };
}
