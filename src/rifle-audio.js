function finitePoint(point) {
  return point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));
}

function requireShot(event) {
  if (!Number.isInteger(event?.id) || event.id < 1 ||
    !['soldierId', 'weaponId'].every(key => typeof event.source?.[key] === 'string' && event.source[key])) {
    throw new RangeError('Rifle audio requires an original shot event identity');
  }
}

function requireOwnedWeaponIds(listener) {
  const ids = listener?.ownedWeaponIds;
  if (ids === undefined) return;
  if (!Array.isArray(ids)) throw new RangeError('Rifle audio ownedWeaponIds must be an array of nonempty weapon IDs');
  for (const id of ids) {
    if (typeof id !== 'string' || !id) throw new RangeError('Rifle audio ownedWeaponIds must be an array of nonempty weapon IDs');
  }
}

function ownedByListener(source, listener) {
  return source.soldierId === listener.soldierId &&
    (source.weaponId === listener.weaponId || listener.ownedWeaponIds?.includes(source.weaponId) === true);
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
  const beyondNear = Math.max(0, distance - 3);
  const fade = Math.max(0, Math.min(1, (240 - distance) / 60));
  return { distance, audible: owned || distance < 240, pan,
    gain: owned ? .65 * 10 ** (5 / 20) : .72 * 3 / (3 + .25 * beyondNear) * fade * fade * (3 - 2 * fade),
    cutoff: owned ? 14000 : Math.max(1400, 14000 / (1 + beyondNear / 18)) };
}

function peakSafetyCurve() {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const value = i * 2 / (curve.length - 1) - 1, magnitude = Math.abs(value);
    curve[i] = Math.sign(value) * (magnitude <= .85 ? magnitude : .85 + .1 * Math.tanh((magnitude - .85) / .1));
  }
  return curve;
}

export function createRifleAudio(buffer, enemyBuffer = buffer, machineGunBuffers = [buffer], friendlyReports = {}) {
  const reports = { fallback: buffer, 'friendly-rifle': friendlyReports.rifle, 'friendly-sniper': friendlyReports.sniper };
  for (const [name, report] of Object.entries(reports)) {
    if (name !== 'fallback' && report === undefined) continue;
    if (!report || !Number.isFinite(report.duration) || report.duration <= 0 || report.duration > .65) {
      throw new RangeError(`Rifle report ${name} must be a decoded short audio buffer`);
    }
  }
  function reportFor(event) {
    if (event.automatic === true || ['machine-gun', 'tank-machine-gun'].includes(event.source.weaponClass)) return 'machine-gun';
    if (event.source.team === 'enemy' && event.weaponType !== 'tank') return 'enemy-rifle';
    const weaponClass = event.source.team === 'friendly' ? event.source.weaponClass : null;
    const name = weaponClass === 'rifle' ? 'friendly-rifle' : weaponClass === 'sniper' ? 'friendly-sniper' : 'fallback';
    return reports[name] ? name : 'fallback';
  }
  if (!enemyBuffer || !Number.isFinite(enemyBuffer.duration) || enemyBuffer.duration <= 0 || enemyBuffer.duration > 4) {
    throw new RangeError('Enemy rifle report must be a decoded audio buffer no longer than four seconds');
  }
  if (!Array.isArray(machineGunBuffers) || !machineGunBuffers.length || machineGunBuffers.some(clip =>
    !clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > .65)) {
    throw new RangeError('Machine-gun reports must be decoded short audio buffers');
  }
  const voices = new Set(), history = [];
  const counts = { played: 0, owned: 0, remote: 0, range: 0, budget: 0, polyphony: 0, suspended: 0, replaced: 0 };
  let context = null, bus = null, safety = null, ownVoice = null, batchRemote = 0, peakVoices = 0;
  const audioMixer = {
    beginBatch() { batchRemote = 0; },
    update(listener) {
      requireOwnedWeaponIds(listener);
      if (!context || context.state !== 'running') return;
      ownVoice = null;
      for (const voice of voices) {
        const owned = ownedByListener(voice, listener);
        const mix = rifleMix(voice.start, listener, owned);
        voice.owned = owned;
        voice.priority = mix.gain;
        if (owned) {
          if (ownVoice) {
            const previous = ownVoice;
            previous.source.stop(); previous.release(); counts.replaced++;
          }
          ownVoice = voice;
        }
        voice.gain.gain.setTargetAtTime(mix.audible ? mix.gain : 0, context.currentTime, .015);
        voice.panner.pan.setTargetAtTime(mix.pan, context.currentTime, .015);
        voice.filter.frequency.setTargetAtTime(mix.cutoff, context.currentTime, .015);
      }
      const remote = [...voices].filter(voice => !voice.owned);
      if (remote.length > 8) {
        const weakest = remote.reduce((selected, voice) => voice.priority < selected.priority ? voice : selected);
        weakest.source.stop(); weakest.release(); counts.replaced++;
      }
    },
    playBatch(audio, events, listener) {
      if (!Array.isArray(events) || events.length > 5120) throw new RangeError('Rifle audio requires a bounded shot batch');
      requireOwnedWeaponIds(listener);
      const ranked = events.map(event => {
        requireShot(event);
        const owned = ownedByListener(event.source, listener);
        return { event, owned, mix: rifleMix(event.start, listener, owned) };
      });
      ranked.sort((a, b) => Number(b.owned) - Number(a.owned) || b.mix.gain - a.mix.gain ||
        a.mix.distance - b.mix.distance || a.event.id - b.event.id);
      audioMixer.beginBatch();
      audioMixer.update(listener);
      let played = 0;
      for (const item of ranked) if (audioMixer.play(audio, item.event, listener, item.owned)) played++;
      return played;
    },
    play(audio, event, listener, owned) {
      requireShot(event);
      requireOwnedWeaponIds(listener);
      const mix = rifleMix(event.start, listener, owned);
      if (!audio || audio.state !== 'running') { counts.suspended++; return false; }
      if (!mix.audible) { counts.range++; return false; }
      if (!owned && batchRemote >= 3) { counts.budget++; return false; }
      if (audio !== context && voices.size) throw new Error('Cannot replace rifle audio context with active voices');
      const remote = [...voices].filter(voice => !voice.owned);
      if (!owned && remote.length >= 8) {
        const weakest = remote.reduce((selected, voice) => voice.priority < selected.priority ? voice : selected);
        if (mix.gain < weakest.priority) { counts.polyphony++; return false; }
        weakest.source.stop(); weakest.release(); counts.replaced++;
      }
      if (audio !== context) {
        bus?.disconnect(); safety?.disconnect();
        context = audio; bus = audio.createGain(); bus.gain.value = .7;
        safety = audio.createWaveShaper(); safety.curve = peakSafetyCurve();
        safety.oversample = 'none';
        bus.connect(safety).connect(audio.destination);
      }
      if (owned && ownVoice) {
        const replaced = ownVoice;
        replaced.source.stop(); replaced.release();
      }
      const source = audio.createBufferSource(), gain = audio.createGain(), filter = audio.createBiquadFilter(), panner = audio.createStereoPanner();
      const report = reportFor(event);
      source.buffer = report === 'machine-gun' ? machineGunBuffers[event.id % machineGunBuffers.length]
        : report === 'enemy-rifle' ? enemyBuffer : reports[report];
      source.playbackRate.value = ['machine-gun', 'enemy-rifle'].includes(report) ? 1 : [1, .99, 1.015][event.id % 3];
      filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
      gain.gain.value = mix.gain; panner.pan.value = mix.pan;
      source.connect(filter).connect(gain).connect(panner).connect(bus);
      const voice = { source, owned, gain, filter, panner, priority: mix.gain, start: { ...event.start }, release: null,
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
        report: report === 'fallback' ? 'recorded-rifle' : report,
        time: event.time ?? null,
        distance: mix.distance, pan: mix.pan, gain: mix.gain, cutoff: mix.cutoff });
      if (history.length > 40) history.shift();
      source.start(audio.currentTime);
      return true;
    },
    reset() {
      for (const voice of [...voices]) { voice.source.stop(); voice.release(); }
      batchRemote = 0; peakVoices = 0; history.length = 0;
      for (const key of Object.keys(counts)) counts[key] = 0;
    },
    get snapshot() {
      return { status: 'recorded', contextState: context?.state ?? 'not-started', duration: buffer.duration, sampleRate: buffer.sampleRate,
        reports: Object.fromEntries(Object.entries(reports).filter(([, report]) => report).map(([name, report]) =>
          [name, { duration: report.duration, sampleRate: report.sampleRate }])),
        enemyDuration: enemyBuffer.duration,
        machineGunDurations: machineGunBuffers.map(clip => clip.duration),
        active: voices.size, peakVoices, counts: { ...counts }, history: history.map(item => ({ ...item })),
        dynamics: { linearBelow: .85, safetyCeiling: .95 },
        limits: { remoteVoices: 8, remotePerBatch: 3, maxDistance: 240, fadeFrom: 180 } };
    },
  };
  return audioMixer;
}

export async function loadRifleAudio() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide offline audio decoding');
  const context = new Audio(1, 1, 24000);
  const [fallback, rifle, sniper, enemyBuffer, ...machineGunBuffers] = await Promise.all([
    '/assets/audio/recorded-rifle/report.wav',
    '/assets/audio/friendly-rifle-generated/rifle-report.wav',
    '/assets/audio/friendly-rifle-generated/sniper-report.wav',
    '/assets/audio/enemy-rifle/report.wav',
    ...[0, 1, 2].map(take => `/assets/audio/machine-gun/shot-${take}.wav`),
  ].map(async path => {
    const response = await fetch(path, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Recorded rifle sound ${path}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    if (header.length < 12 || String.fromCharCode(...header.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...header.subarray(8, 12)) !== 'WAVE') {
      throw new Error(`Recorded rifle sound ${path}: expected RIFF/WAVE audio, received ${response.headers?.get('content-type') ?? 'unknown content type'} (${bytes.byteLength} bytes). Check asset publishing; restart the development server after adding public assets.`);
    }
    try {
      return await context.decodeAudioData(bytes);
    } catch (error) {
      throw new Error(`Recorded rifle sound ${path}: ${error.name}: ${error.message}`, { cause: error });
    }
  }));
  return createRifleAudio(fallback, enemyBuffer, machineGunBuffers, { rifle, sniper });
}
