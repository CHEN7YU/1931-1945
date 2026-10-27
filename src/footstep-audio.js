export const FOOTSTEP_SAMPLES = Object.freeze({
  stone: Object.freeze({ file: 'concrete.ogg', seconds: .11, cutoff: 6000 }),
  wood: Object.freeze({ file: 'wood.ogg', seconds: .14, cutoff: 3800 }),
  earth: Object.freeze({ file: 'grass.ogg', seconds: .16, cutoff: 2200 }),
});

export function prepareFootstep(samples, sampleRate, seconds) {
  if (!(samples instanceof Float32Array) || samples.length < 2 || !Number.isFinite(sampleRate) || sampleRate < 8000 ||
    !Number.isFinite(seconds) || seconds < .05 || seconds > .2) throw new RangeError('Invalid decoded footstep');
  const length = Math.min(samples.length, Math.round(sampleRate * seconds));
  const result = samples.slice(0, length);
  let mean = 0, peak = 0;
  for (const value of result) {
    if (!Number.isFinite(value)) throw new RangeError('Non-finite footstep samples');
    mean += value;
  }
  mean /= length;
  for (const value of result) peak = Math.max(peak, Math.abs(value - mean));
  if (peak < .001) throw new Error('Footstep recording is silent');
  const attack = Math.max(1, Math.round(sampleRate * .0005)), release = Math.max(1, Math.round(sampleRate * .025));
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / attack, (length - 1 - i) / release);
    result[i] = (result[i] - mean) * (.7 / peak) * fade;
  }
  return result;
}

export function createFootstepAudio(buffers) {
  for (const surface of Object.keys(FOOTSTEP_SAMPLES)) {
    const buffer = buffers?.[surface];
    if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > .201 ||
      buffer.numberOfChannels !== 1) throw new RangeError(`Footstep requires a short mono ${surface} buffer`);
  }
  const voices = new Set(), history = [];
  const counts = { played: 0, stale: 0, suspended: 0, budget: 0, replaced: 0 };
  let owner = null, active = false, batch = 0, context = null, peakVoices = 0;
  function stop() {
    for (const voice of [...voices]) { voice.source.stop(); voice.release(); }
  }
  function sync(soldierId, playing) {
    if (typeof playing !== 'boolean' || soldierId !== null && (typeof soldierId !== 'string' || !soldierId)) {
      throw new RangeError('Footstep playback requires explicit owner and activity');
    }
    if (!playing || owner !== soldierId) stop();
    owner = soldierId; active = playing;
  }
  return {
    sync,
    beginBatch(soldierId, playing) {
      sync(soldierId, playing);
      batch = 0;
    },
    play(audio, event) {
      if (!Number.isInteger(event?.id) || event.id < 1 || typeof event.soldierId !== 'string' || !event.soldierId ||
        !Object.hasOwn(FOOTSTEP_SAMPLES, event.surface) || !['standing', 'crouched', 'prone'].includes(event.stance) ||
        !Number.isFinite(event.speed) || event.speed < 0 || typeof event.landing !== 'boolean') {
        throw new RangeError('Invalid recorded footstep event');
      }
      if (event.stance === 'prone' && !event.landing) throw new Error('Contact recordings are not crawling audio');
      if (!active || event.soldierId !== owner) { counts.stale++; return false; }
      if (!audio || audio.state !== 'running') { counts.suspended++; return false; }
      if (batch >= 2) { counts.budget++; return false; }
      if (context && audio !== context) stop();
      context = audio;
      if (voices.size >= 4) {
        const oldest = voices.values().next().value;
        oldest.source.stop(); oldest.release(); counts.replaced++;
      }
      const source = audio.createBufferSource(), gain = audio.createGain(), filter = audio.createBiquadFilter();
      const sample = FOOTSTEP_SAMPLES[event.surface];
      source.buffer = buffers[event.surface];
      source.playbackRate.value = [1, .98, 1.02, .99][event.id % 4];
      filter.type = 'lowpass';
      filter.frequency.value = event.landing ? Math.min(sample.cutoff, 2400) : sample.cutoff;
      const volume = (.12 + Math.min(event.speed, 5) * .022) * (event.landing ? 1.4 : event.stance === 'crouched' ? .65 : 1);
      gain.gain.value = volume;
      source.connect(filter).connect(gain).connect(audio.destination);
      let ended = false;
      const voice = { source, release() {
        if (ended) return;
        ended = true; voices.delete(voice);
        source.disconnect(); filter.disconnect(); gain.disconnect();
      } };
      source.onended = voice.release;
      voices.add(voice); batch++; counts.played++;
      peakVoices = Math.max(peakVoices, voices.size);
      history.push({ eventId: event.id, soldierId: event.soldierId, surface: event.surface, sample: sample.file,
        speed: event.speed, stance: event.stance, landing: event.landing, volume, rate: source.playbackRate.value });
      if (history.length > 32) history.shift();
      source.start(audio.currentTime);
      return true;
    },
    get snapshot() {
      return { status: 'recorded', owner, active: voices.size, peakVoices, counts: { ...counts },
        samples: Object.fromEntries(Object.entries(buffers).map(([surface, buffer]) => [surface,
          { file: FOOTSTEP_SAMPLES[surface].file, duration: buffer.duration, sampleRate: buffer.sampleRate }])),
        history: history.map(item => ({ ...item })), limits: { voices: 4, perBatch: 2 } };
    },
  };
}

export async function loadFootstepAudio() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide offline footstep decoding');
  const context = new Audio(1, 1, 24000);
  const pairs = await Promise.all(Object.entries(FOOTSTEP_SAMPLES).map(async ([surface, sample]) => {
    const response = await fetch(`/assets/audio/kenney-impact/${sample.file}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Recorded ${surface} footstep: HTTP ${response.status}`);
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
    }
    const prepared = prepareFootstep(mono, decoded.sampleRate, sample.seconds);
    const buffer = context.createBuffer(1, prepared.length, decoded.sampleRate);
    buffer.copyToChannel(prepared, 0);
    return [surface, buffer];
  }));
  return createFootstepAudio(Object.fromEntries(pairs));
}
