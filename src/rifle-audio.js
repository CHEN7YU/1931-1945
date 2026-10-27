function finitePoint(point) {
  return point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));
}

export function rifleMix(start, listener, owned = false) {
  if (!finitePoint(start) || !finitePoint(listener?.position) || !finitePoint(listener?.right) || typeof owned !== 'boolean') {
    throw new RangeError('Rifle audio requires finite source/listener positions and orientation');
  }
  const delta = { x: start.x - listener.position.x, y: start.y - listener.position.y, z: start.z - listener.position.z };
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  const rightLength = Math.hypot(listener.right.x, listener.right.y, listener.right.z);
  if (rightLength < 1e-6) throw new RangeError('Rifle audio listener right vector is degenerate');
  const pan = owned ? 0 : Math.max(-.95, Math.min(.95,
    (delta.x * listener.right.x + delta.y * listener.right.y + delta.z * listener.right.z) / Math.max(1, distance) / rightLength));
  return { distance, audible: owned || distance <= 100, pan,
    gain: owned ? .65 : .12 / (1 + (distance / 14) ** 2),
    cutoff: owned ? 14000 : Math.max(1800, 14000 / (1 + distance / 18)) };
}

export function createRifleAudio(buffer) {
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > .65) {
    throw new RangeError('Rifle report must be a decoded short audio buffer');
  }
  const voices = new Set(), history = [];
  const counts = { played: 0, owned: 0, remote: 0, range: 0, budget: 0, polyphony: 0, suspended: 0 };
  let context = null, bus = null, ownVoice = null, batchRemote = 0, peakVoices = 0;
  return {
    beginBatch() { batchRemote = 0; },
    update(listener) {
      if (!context || context.state !== 'running') return;
      for (const voice of voices) {
        const owned = voice.soldierId === listener.soldierId && voice.weaponId === listener.weaponId;
        const mix = rifleMix(voice.start, listener, owned);
        voice.gain.gain.setTargetAtTime(mix.audible ? mix.gain : 0, context.currentTime, .015);
        voice.panner.pan.setTargetAtTime(mix.pan, context.currentTime, .015);
        voice.filter.frequency.setTargetAtTime(mix.cutoff, context.currentTime, .015);
      }
    },
    play(audio, event, listener, owned) {
      if (!Number.isInteger(event?.id) || event.id < 1 || !event.source?.soldierId || !event.source?.weaponId) {
        throw new RangeError('Rifle audio requires an original shot event identity');
      }
      const mix = rifleMix(event.start, listener, owned);
      if (!audio || audio.state !== 'running') { counts.suspended++; return false; }
      if (!mix.audible) { counts.range++; return false; }
      if (!owned && batchRemote >= 3) { counts.budget++; return false; }
      if (!owned && [...voices].filter(voice => !voice.owned).length >= 8) { counts.polyphony++; return false; }
      if (audio !== context) {
        if (voices.size) throw new Error('Cannot replace rifle audio context with active voices');
        bus?.disconnect();
        context = audio; bus = audio.createGain(); bus.gain.value = .7; bus.connect(audio.destination);
      }
      if (owned && ownVoice) {
        const replaced = ownVoice;
        replaced.source.stop(); replaced.release();
      }
      const source = audio.createBufferSource(), gain = audio.createGain(), filter = audio.createBiquadFilter(), panner = audio.createStereoPanner();
      source.buffer = buffer; source.playbackRate.value = [1, .99, 1.015][event.id % 3];
      filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
      gain.gain.value = mix.gain; panner.pan.value = mix.pan;
      source.connect(filter).connect(gain).connect(panner).connect(bus);
      const voice = { source, owned, gain, filter, panner, start: { ...event.start }, release: null,
        soldierId: event.source.soldierId, weaponId: event.source.weaponId };
      let ended = false;
      voice.release = () => {
        if (ended) return;
        ended = true;
        voices.delete(voice);
        if (ownVoice === voice) ownVoice = null;
        source.disconnect(); gain.disconnect(); filter.disconnect(); panner.disconnect();
      };
      source.onended = voice.release;
      voices.add(voice);
      if (owned) ownVoice = voice;
      else batchRemote++;
      counts.played++; counts[owned ? 'owned' : 'remote']++;
      peakVoices = Math.max(peakVoices, voices.size);
      history.push({ eventId: event.id, soldierId: event.source.soldierId, credit: event.source.credit, owned,
        distance: mix.distance, pan: mix.pan, gain: mix.gain, cutoff: mix.cutoff });
      if (history.length > 40) history.shift();
      source.start(audio.currentTime);
      return true;
    },
    get snapshot() {
      return { status: 'recorded', contextState: context?.state ?? 'not-started', duration: buffer.duration, sampleRate: buffer.sampleRate,
        active: voices.size, peakVoices, counts: { ...counts }, history: history.map(item => ({ ...item })),
        limits: { remoteVoices: 8, remotePerBatch: 3, maxDistance: 100 } };
    },
  };
}

export async function loadRifleAudio() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide offline audio decoding');
  const response = await fetch('/assets/audio/recorded-rifle/report.wav', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Recorded rifle sound: HTTP ${response.status}`);
  const context = new Audio(1, 1, 24000);
  return createRifleAudio(await context.decodeAudioData(await response.arrayBuffer()));
}
