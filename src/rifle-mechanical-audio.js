export const RIFLE_MECHANICAL_SAMPLES = Object.freeze({
  unlock: 'unlock.wav',
  extract: 'extract.wav',
  load: 'load.wav',
  close: 'close.wav',
});

export function createRifleMechanicalAudio(buffers) {
  for (const cue of Object.keys(RIFLE_MECHANICAL_SAMPLES)) {
    const buffer = buffers?.[cue];
    if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > .35 ||
      buffer.numberOfChannels !== 1 || buffer.sampleRate !== 24000) {
      throw new RangeError(`Mechanical audio requires a short mono 24kHz ${cue} buffer`);
    }
  }
  const samples = Object.fromEntries(Object.keys(RIFLE_MECHANICAL_SAMPLES).map(cue => [cue, buffers[cue]]));
  const voices = new Set(), history = [];
  const counts = { played: 0, stale: 0, duplicate: 0, suspended: 0, budget: 0, replaced: 0 };
  let owner = null, active = false, batch = 0, context = null, lastEventId = 0, peakVoices = 0;
  let output = null;
  function stop() {
    for (const voice of [...voices]) { voice.source.stop(); voice.release(); }
  }
  function sync(nextOwner, playing) {
    if (typeof playing !== 'boolean' || nextOwner !== null &&
      (!nextOwner || !['soldierId', 'weaponId'].every(key => typeof nextOwner[key] === 'string' && nextOwner[key])) ||
      playing && nextOwner === null) {
      throw new RangeError('Mechanical playback requires explicit soldier/weapon ownership and activity');
    }
    if (!playing || owner?.soldierId !== nextOwner?.soldierId || owner?.weaponId !== nextOwner?.weaponId) stop();
    owner = nextOwner === null ? null : { soldierId: nextOwner.soldierId, weaponId: nextOwner.weaponId };
    active = playing;
  }
  return {
    setOutput(node) { output = node; },
    sync,
    beginBatch(nextOwner, playing) {
      sync(nextOwner, playing);
      batch = 0;
    },
    play(audio, event) {
      if (event?.type !== 'weapon.mechanical' || !Number.isInteger(event.id) || event.id < 1 ||
        !Number.isFinite(event.time) || event.time < 0 ||
        !['soldierId', 'weaponId'].every(key => typeof event[key] === 'string' && event[key]) ||
        !Object.hasOwn(RIFLE_MECHANICAL_SAMPLES, event.cue)) {
        throw new RangeError('Mechanical audio requires an original weapon.mechanical event');
      }
      if (event.id <= lastEventId) { counts.duplicate++; return false; }
      lastEventId = event.id;
      if (!active || event.soldierId !== owner.soldierId || event.weaponId !== owner.weaponId) { counts.stale++; return false; }
      if (!audio || audio.state !== 'running') { counts.suspended++; return false; }
      if (batch >= 3) { counts.budget++; return false; }
      if (context && audio !== context) stop();
      context = audio;
      if (voices.size >= 4) {
        const oldest = voices.values().next().value;
        oldest.source.stop(); oldest.release(); counts.replaced++;
      }
      const source = audio.createBufferSource(), gain = audio.createGain();
      source.buffer = samples[event.cue];
      gain.gain.value = .12;
      source.connect(gain).connect(output ?? audio.destination);
      let ended = false;
      const voice = { source, release() {
        if (ended) return;
        ended = true; voices.delete(voice);
        source.disconnect(); gain.disconnect();
      } };
      source.onended = voice.release;
      voices.add(voice); batch++; counts.played++;
      peakVoices = Math.max(peakVoices, voices.size);
      history.push({ eventId: event.id, time: event.time, soldierId: event.soldierId, weaponId: event.weaponId,
        cue: event.cue, file: RIFLE_MECHANICAL_SAMPLES[event.cue] });
      if (history.length > 32) history.shift();
      source.start(audio.currentTime);
      return true;
    },
    reset() {
      stop();
      owner = null; active = false; batch = 0; context = null; lastEventId = 0; peakVoices = 0;
      history.length = 0;
      for (const key of Object.keys(counts)) counts[key] = 0;
    },
    get snapshot() {
      return { status: 'recorded', owner: owner && { ...owner }, playing: active, active: voices.size, peakVoices,
        counts: { ...counts }, history: history.map(item => ({ ...item })),
        samples: Object.fromEntries(Object.entries(samples).map(([cue, buffer]) => [cue,
          { file: RIFLE_MECHANICAL_SAMPLES[cue], duration: buffer.duration, sampleRate: buffer.sampleRate }])),
        limits: { voices: 4, perBatch: 3 } };
    },
  };
}

export async function loadRifleMechanicalAudio() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide offline mechanical audio decoding');
  const context = new Audio(1, 1, 24000);
  const pairs = await Promise.all(Object.entries(RIFLE_MECHANICAL_SAMPLES).map(async ([cue, file]) => {
    const response = await fetch(`/assets/audio/rifle-mechanical/${file}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Recorded mechanical ${cue}: HTTP ${response.status}`);
    return [cue, await context.decodeAudioData(await response.arrayBuffer())];
  }));
  return createRifleMechanicalAudio(Object.fromEntries(pairs));
}
