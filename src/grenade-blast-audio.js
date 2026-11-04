import { rifleMix } from './rifle-audio.js';

export const GRENADE_BLAST_VOICES = 3;
export function grenadeBlastMix(position, listener) {
  const mix = rifleMix(position, listener);
  return { ...mix, gain: mix.gain * Math.max(0, Math.min(1, (150 - mix.distance) / 35)),
    flash: .24 * Math.max(0, 1 - mix.distance / 10) };
}

export function createGrenadeBlastAudio(context, noise, output) {
  const voices = new Set();
  let played = 0, peak = 0;
  return {
    play(position, listener) {
      if (context.state !== 'running') return false;
      const mix = grenadeBlastMix(position, listener);
      if (mix.distance >= 150) return false;
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
      gain.gain.exponentialRampToValueAtTime(.001, at + .72);
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
      source.start(at); source.stop(at + .76); body.start(at); body.stop(at + .65);
      played++; peak = Math.max(peak, voices.size); return true;
    },
    reset() { for (const voice of [...voices]) voice.stop(); },
    get snapshot() { return { active: voices.size, played, peak, limit: GRENADE_BLAST_VOICES }; },
  };
}
