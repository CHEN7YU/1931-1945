import { rifleMix } from './rifle-audio.js';

export const VEHICLE_AUDIO_LIMITS = Object.freeze({ voices: 3, fadeVoices: 3, tankRange: 130, planeRange: 220 });
export const VEHICLE_ENGINE_FILES = Object.freeze({ tank: 'tank-engine.wav', plane: 'plane-engine.wav' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function vehicleEngineMix(vehicle, listener, previous, time) {
  if (!Object.hasOwn(VEHICLE_ENGINE_FILES, vehicle.type) || typeof vehicle.id !== 'string' ||
    !Number.isFinite(time) || time < 0 || !Number.isFinite(vehicle.health)) throw new RangeError('Invalid vehicle engine state');
  if (vehicle.speed != null && !Number.isFinite(vehicle.speed) || vehicle.throttle != null && !Number.isFinite(vehicle.throttle) ||
    vehicle.groundMotion && !['x', 'z', 'turn'].every(axis => Number.isFinite(vehicle.groundMotion[axis])))
    throw new RangeError('Vehicle engine load must come from finite physical motion');
  const owned = vehicle.id === listener.vehicleId, spatial = rifleMix(vehicle.position, listener, owned);
  const range = vehicle.type === 'tank' ? VEHICLE_AUDIO_LIMITS.tankRange : VEHICLE_AUDIO_LIMITS.planeRange;
  const elapsed = previous ? time - previous.time : 0;
  const measured = elapsed > 0 ? Math.hypot(vehicle.position.x - previous.position.x,
    vehicle.position.y - previous.position.y, vehicle.position.z - previous.position.z) / elapsed : previous?.speed ?? 0;
  const speed = vehicle.type === 'tank' && vehicle.groundMotion
    ? Math.hypot(vehicle.groundMotion.x, vehicle.groundMotion.z)
    : elapsed > 0 ? measured : Math.max(0, vehicle.speed ?? measured);
  const tankSpeed = vehicle.groundMotion ? speed : measured;
  const load = vehicle.type === 'tank'
    ? clamp(tankSpeed / 4.8 + Math.abs(vehicle.groundMotion?.turn ?? 0) * .3, 0, 1)
    : clamp(vehicle.throttle ?? .65, 0, 1);
  const radial = !owned && elapsed > 0 && elapsed < .5 && previous.listenerId === listener.soldierId &&
    previous.listenerVehicleId === listener.vehicleId
    ? clamp((previous.distance - spatial.distance) / elapsed, -60, 60) : 0;
  const doppler = clamp(343 / (343 - radial), .88, 1.15);
  const pitch = vehicle.type === 'tank' ? .74 + load * .48 : .78 + load * .25 + Math.min(speed, 82) * .002;
  const fade = owned ? 1 : clamp((range - spatial.distance) / (range * .25), 0, 1);
  return {
    audible: vehicle.health > 0 && vehicle.engineOn !== false && (owned || spatial.distance < range),
    owned, distance: spatial.distance, speed: vehicle.type === 'tank' ? tankSpeed : speed,
    rate: clamp(pitch * doppler, .65, 1.4),
    gain: spatial.gain * fade * (owned ? vehicle.type === 'tank' ? .12 : .13 : vehicle.type === 'tank' ? .42 : .5),
    pan: owned ? 0 : spatial.pan,
    cutoff: owned ? vehicle.type === 'tank' ? 1000 : 2100 : vehicle.type === 'tank'
      ? Math.max(450, 2300 / (1 + spatial.distance / 40)) : Math.max(700, 5000 / (1 + spatial.distance / 65)),
  };
}

export function createVehicleAudio(buffers) {
  for (const [type, file] of Object.entries(VEHICLE_ENGINE_FILES)) {
    const buffer = buffers[file];
    if (!buffer || buffer.numberOfChannels !== 1 || !Number.isFinite(buffer.duration) ||
      buffer.duration < 1 || buffer.duration > 10) throw new RangeError(`Invalid ${type} engine loop`);
  }
  const voices = new Map(), retiring = new Set(), motion = new Map(), history = [];
  let context = null, output = null;
  const counts = { started: 0, stopped: 0, peak: 0 };
  const stop = voice => {
    if (voice.stopping || voice.released) return;
    voice.stopping = true; counts.stopped++;
    if (voices.get(voice.id) === voice) voices.delete(voice.id);
    if (context?.state === 'running') {
      if (retiring.size >= VEHICLE_AUDIO_LIMITS.fadeVoices) {
        const oldest = retiring.values().next().value;
        oldest.source.stop(); oldest.release();
      }
      retiring.add(voice);
      voice.gain.gain.setTargetAtTime(0, context.currentTime, .008);
      voice.source.stop(context.currentTime + .03);
    } else { voice.source.stop(); voice.release(); }
  };
  const stopAll = () => { for (const voice of [...voices.values()]) stop(voice); };
  return {
    setOutput(node) { output = node; },
    sync(enabled) { if (!enabled) stopAll(); },
    update(audio, vehicles, listener, time, enabled) {
      if (!enabled || !audio || audio.state !== 'running') { stopAll(); return; }
      if (context && context !== audio) {
        stopAll();
        for (const voice of [...retiring]) { voice.source.stop(); voice.release(); }
      }
      context = audio;
      const records = [...vehicles], ids = new Set(records.map(vehicle => vehicle.id));
      for (const id of motion.keys()) if (!ids.has(id)) motion.delete(id);
      const candidates = [];
      for (const vehicle of records) {
        const previous = motion.get(vehicle.id), mix = vehicleEngineMix(vehicle, listener, previous, time);
        motion.set(vehicle.id, { time, position: { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z },
          distance: mix.distance, speed: mix.speed, listenerId: listener.soldierId, listenerVehicleId: listener.vehicleId });
        if (mix.audible && mix.gain > .004) candidates.push({ vehicle, mix,
          priority: mix.owned ? 1000 : mix.gain * (voices.has(vehicle.id) ? 1.12 : 1) });
      }
      candidates.sort((a, b) => b.priority - a.priority || a.vehicle.id.localeCompare(b.vehicle.id));
      const selected = candidates.slice(0, VEHICLE_AUDIO_LIMITS.voices), selectedIds = new Set(selected.map(item => item.vehicle.id));
      for (const voice of [...voices.values()]) if (!selectedIds.has(voice.id)) stop(voice);
      for (const { vehicle, mix } of selected) {
        let voice = voices.get(vehicle.id);
        if (!voice) {
          const source = audio.createBufferSource(), gain = audio.createGain(), pan = audio.createStereoPanner(), filter = audio.createBiquadFilter();
          source.buffer = buffers[VEHICLE_ENGINE_FILES[vehicle.type]];
          source.loop = true; source.loopStart = 0; source.loopEnd = source.buffer.duration;
          source.playbackRate.value = mix.rate;
          gain.gain.value = 0; pan.pan.value = mix.pan; filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
          source.connect(filter).connect(gain).connect(pan).connect(output ?? audio.destination);
          voice = { id: vehicle.id, type: vehicle.type, source, gain, pan, filter, released: false, stopping: false,
            release() {
              if (voice.released) return;
              voice.released = true;
              if (voices.get(voice.id) === voice) voices.delete(voice.id);
              retiring.delete(voice);
              source.disconnect(); gain.disconnect(); pan.disconnect(); filter.disconnect();
            } };
          source.onended = voice.release; voices.set(vehicle.id, voice); counts.started++;
          source.start(audio.currentTime, time % source.buffer.duration);
          history.push({ vehicleId: vehicle.id, type: vehicle.type, file: VEHICLE_ENGINE_FILES[vehicle.type], time });
          if (history.length > 32) history.shift();
        }
        voice.owned = mix.owned; voice.rate = mix.rate; voice.targetGain = mix.gain; voice.targetPan = mix.pan;
        voice.source.playbackRate.setTargetAtTime(mix.rate, audio.currentTime, .14);
        voice.gain.gain.setTargetAtTime(mix.gain, audio.currentTime, .06);
        voice.pan.pan.setTargetAtTime(mix.pan, audio.currentTime, .06);
        voice.filter.frequency.setTargetAtTime(mix.cutoff, audio.currentTime, .1);
      }
      counts.peak = Math.max(counts.peak, voices.size);
    },
    reset() {
      stopAll();
      for (const voice of [...retiring]) { voice.source.stop(); voice.release(); }
      motion.clear(); history.length = 0;
      counts.started = counts.stopped = counts.peak = 0;
    },
    get snapshot() { return { active: voices.size, fading: retiring.size, limits: VEHICLE_AUDIO_LIMITS, counts: { ...counts },
      voices: [...voices.values()].map(voice => ({ vehicleId: voice.id, type: voice.type, owned: voice.owned,
        rate: voice.rate, gain: voice.targetGain, pan: voice.targetPan })),
      history: history.map(item => ({ ...item })) }; },
  };
}

export async function loadVehicleAudio() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide vehicle audio decoding');
  const context = new Audio(1, 1, 24000), buffers = {};
  await Promise.all(Object.values(VEHICLE_ENGINE_FILES).map(async file => {
    const response = await fetch(`/assets/audio/vehicle-engines/${file}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Vehicle engine ${file}: HTTP ${response.status}`);
    buffers[file] = await context.decodeAudioData(await response.arrayBuffer());
  }));
  return createVehicleAudio(buffers);
}
