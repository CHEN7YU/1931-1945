import { rifleMix } from './rifle-audio.js';

export const TACTICAL_AUDIO_LIMITS = Object.freeze({ voices: 8, perFrame: 4, queue: 64, flybyDistance: 2.5, shotCandidates: 32 });
export const FEEDBACK_SOUNDS = Object.freeze({
  flyby: { file: 'flyby.wav', group: 'weapons', range: 4, gain: .27, cutoff: 7500, cooldown: .18, priority: 6 },
  'hit-stone': { file: 'hit-stone.wav', group: 'weapons', range: 30, gain: .32, cutoff: 6500, cooldown: .09, priority: 5 },
  'hit-wood': { file: 'hit-wood.wav', group: 'weapons', range: 26, gain: .30, cutoff: 4200, cooldown: .09, priority: 5 },
  'hit-soil': { file: 'hit-soil.wav', group: 'weapons', range: 22, gain: .24, cutoff: 2400, cooldown: .09, priority: 5 },
  'hit-generic': { file: 'hit-generic.wav', group: 'weapons', range: 26, gain: .25, cutoff: 4500, cooldown: .09, priority: 5 },
  'deck-step': { file: 'deck-step.wav', group: 'footsteps', range: 20, gain: .21, cutoff: 3600, cooldown: .18, priority: 3 },
  oar: { file: 'oar.wav', group: 'effects', range: 35, gain: .24, cutoff: 4500, cooldown: .8, priority: 2 },
  'water-crash': { file: 'water-crash.wav', group: 'effects', range: 125, gain: 1, cutoff: 6000, cooldown: 1, priority: 8 },
  bubbles: { file: 'bubbles.wav', group: 'effects', range: 48, gain: .38, cutoff: 1600, cooldown: .45, priority: 2 },
  'submerged-metal': { file: 'submerged-metal.wav', group: 'effects', range: 55, gain: .26, cutoff: 650, cooldown: 1, priority: 2 },
});
const finitePoint = point => point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));
const copyPoint = point => ({ x: point.x, y: point.y, z: point.z });
const shotKey = event => `${event.source.weaponId}:${event.time}`;

export function shotNearPass(start, end, listenerPosition) {
  if (![start, end, listenerPosition].every(finitePoint)) throw new RangeError('Near-pass audio requires finite resolved shot geometry');
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z, lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared < 1e-8) return null;
  const fraction = ((listenerPosition.x - start.x) * dx + (listenerPosition.y - start.y) * dy +
    (listenerPosition.z - start.z) * dz) / lengthSquared;
  if (fraction <= 0 || fraction >= 1 || (1 - fraction) * Math.sqrt(lengthSquared) < .75) return null;
  const point = { x: start.x + dx * fraction, y: start.y + dy * fraction, z: start.z + dz * fraction };
  const distance = Math.hypot(point.x - listenerPosition.x, point.y - listenerPosition.y, point.z - listenerPosition.z);
  return distance >= .32 && distance <= TACTICAL_AUDIO_LIMITS.flybyDistance ? { point, distance } : null;
}

export function createTacticalFeedbackAudio(buffers) {
  const common = ['flyby', 'hit-stone', 'hit-wood', 'hit-soil', 'hit-generic'];
  for (const [kind, definition] of Object.entries(FEEDBACK_SOUNDS)) {
    const buffer = buffers[definition.file];
    if (!buffer && !common.includes(kind)) continue;
    if (!buffer || buffer.numberOfChannels !== 1 || !Number.isFinite(buffer.duration) ||
      buffer.duration < .025 || buffer.duration > 2.1) throw new RangeError(`Invalid tactical audio: ${definition.file}`);
  }
  const voices = new Set(), pending = [], shots = [], observerHits = new Set(), cooldowns = new Map(), history = [];
  const wetOars = new Map(), waterStarts = new Set(), sinking = new Map();
  const counts = { requested: 0, played: 0, budget: 0, cooldown: 0, range: 0, stale: 0, ownShots: 0, observerHits: 0 };
  let enabled = false, outputs = {}, serial = 0, context = null, peak = 0;
  function stop() {
    for (const voice of [...voices]) { voice.source.stop(); voice.release(); }
  }
  function emit(kind, position, time, identity = kind, gainScale = 1) {
    if (!FEEDBACK_SOUNDS[kind] || !buffers[FEEDBACK_SOUNDS[kind].file] || !finitePoint(position) ||
      !Number.isFinite(time) || time < 0 || !Number.isFinite(gainScale) || gainScale < 0 || gainScale > 1)
      throw new RangeError('Invalid or unavailable tactical sound event');
    if (!enabled) return false;
    counts.requested++;
    if (pending.length >= TACTICAL_AUDIO_LIMITS.queue) { counts.budget++; return false; }
    pending.push({ id: ++serial, kind, position: copyPoint(position), time, identity: String(identity), gainScale });
    return true;
  }
  return {
    setOutputs(nodes) { outputs = nodes; },
    sync(active) {
      enabled = active;
      if (!active) { stop(); pending.length = shots.length = 0; observerHits.clear(); }
    },
    beginFrame() { shots.length = 0; observerHits.clear(); },
    emit,
    consume(event, listener) {
      if (!enabled) return;
      if (event.type === 'shot' && event.end && ['infantry', 'plane'].includes(event.weaponType)) {
        if (event.source.soldierId === listener.soldierId) { counts.ownShots++; return; }
        const pass = shotNearPass(event.start, event.end, listener.position);
        if (pass) {
          if (shots.length >= TACTICAL_AUDIO_LIMITS.shotCandidates) { counts.budget++; return; }
          shots.push({ event, pass, listenerId: listener.soldierId });
        }
      } else if (event.type === 'damage' && event.target.kind === 'soldier' &&
        event.target.id === listener.soldierId && event.source.weaponId) observerHits.add(shotKey(event));
      else if (event.type === 'impact' && event.kind) {
        emit(`hit-${event.kind}`, event.position, event.time, `impact:${event.kind}`);
      }
    },
    rower(ferry, time, waterHeight, deepWater) {
      if (!enabled) return;
      const { state, oar, ferryId } = ferry.userData;
      if (!['outbound', 'inbound'].includes(state) || !ferry.visible) { wetOars.set(ferryId, false); return; }
      const tip = oar.userData.bladeTip;
      if (!Array.isArray(tip) || tip.length !== 3 || !tip.every(Number.isFinite)) throw new Error('A rowing sound requires the actual blade tip');
      oar.updateWorldMatrix(true, false);
      const m = oar.matrixWorld.elements;
      const point = { x: m[0] * tip[0] + m[4] * tip[1] + m[8] * tip[2] + m[12],
        y: m[1] * tip[0] + m[5] * tip[1] + m[9] * tip[2] + m[13],
        z: m[2] * tip[0] + m[6] * tip[1] + m[10] * tip[2] + m[14] };
      const wet = deepWater(point.x, point.z) && point.y <= waterHeight(point.x, point.z) + .04;
      if (wet && !wetOars.get(ferryId)) emit('oar', { ...point, y: waterHeight(point.x, point.z) }, time, `oar:${ferryId}`);
      wetOars.set(ferryId, wet);
    },
    waterCrash(vehicle, time) {
      if (!enabled || !vehicle.fall?.sinking || waterStarts.has(vehicle.id)) return false;
      if (waterStarts.size >= 128) waterStarts.delete(waterStarts.values().next().value);
      waterStarts.add(vehicle.id);
      sinking.set(vehicle.id, { at: time, pulses: 0, metal: false });
      return emit('water-crash', { x: vehicle.position.x, y: vehicle.fall.waterLevel, z: vehicle.position.z }, time, vehicle.id);
    },
    flush(audio, listener, time, vehicles) {
      if (!enabled) return;
      if (!audio || audio.state !== 'running') { pending.length = shots.length = 0; observerHits.clear(); return; }
      if (context && audio !== context) stop();
      context = audio;
      for (const { event, pass, listenerId } of shots) {
        if (listenerId !== listener.soldierId) { counts.stale++; continue; }
        if (observerHits.has(shotKey(event))) counts.observerHits++;
        else emit('flyby', pass.point, event.time, 'flyby');
      }
      shots.length = 0; observerHits.clear();
      const live = sinking.size ? new Map([...vehicles].map(vehicle => [vehicle.id, vehicle])) : null;
      for (const [id, state] of sinking) {
        const vehicle = live.get(id), age = time - state.at;
        if (!vehicle?.fall?.sinking || vehicle.fall.sunk || age > 2.2) { sinking.delete(id); continue; }
        const depth = Math.max(0, vehicle.fall.waterLevel - vehicle.position.y), scale = Math.max(0, 1 - depth / 5);
        const point = { x: vehicle.position.x, y: vehicle.fall.waterLevel, z: vehicle.position.z };
        if (!state.metal && age >= .3) { emit('submerged-metal', point, time, id, scale); state.metal = true; }
        if (state.pulses < 3 && age >= .4 + state.pulses * .55) {
          emit('bubbles', point, time, id, scale); state.pulses++;
        }
      }
      if (!pending.length) return;
      const ranked = pending.splice(0).map(event => ({ event, definition: FEEDBACK_SOUNDS[event.kind],
        mix: rifleMix(event.position, listener) }));
      ranked.sort((a, b) => b.definition.priority - a.definition.priority || b.mix.gain - a.mix.gain || a.event.id - b.event.id);
      let played = 0;
      for (const { event, definition, mix } of ranked) {
        if (time - event.time > .4) { counts.stale++; continue; }
        if (mix.distance >= definition.range) { counts.range++; continue; }
        const key = `${event.kind}:${event.identity}`;
        if (time < (cooldowns.get(key) ?? -Infinity)) { counts.cooldown++; continue; }
        if (played >= TACTICAL_AUDIO_LIMITS.perFrame) { counts.budget++; continue; }
        if (voices.size >= TACTICAL_AUDIO_LIMITS.voices) {
          const weakest = [...voices].reduce((selected, voice) => voice.priority < selected.priority ? voice : selected);
          if (definition.priority <= weakest.priority) { counts.budget++; continue; }
          weakest.source.stop(); weakest.release();
        }
        const source = audio.createBufferSource(), gain = audio.createGain(), pan = audio.createStereoPanner(), filter = audio.createBiquadFilter();
        source.buffer = buffers[definition.file];
        filter.type = event.kind === 'flyby' ? 'bandpass' : 'lowpass';
        filter.frequency.value = event.kind === 'flyby' ? 3500 : definition.cutoff;
        if (event.kind === 'flyby') filter.Q.value = .6;
        const fade = Math.max(0, Math.min(1, (definition.range - mix.distance) / (definition.range * .25)));
        gain.gain.value = mix.gain * definition.gain * fade * event.gainScale; pan.pan.value = mix.pan;
        source.connect(filter).connect(gain).connect(pan).connect(outputs[definition.group] ?? audio.destination);
        let ended = false;
        const voice = { source, priority: definition.priority, release() {
          if (ended) return;
          ended = true; voices.delete(voice); source.disconnect(); gain.disconnect(); pan.disconnect(); filter.disconnect();
        } };
        source.onended = voice.release; voices.add(voice); source.start();
        if (!cooldowns.has(key) && cooldowns.size >= 256) cooldowns.delete(cooldowns.keys().next().value);
        cooldowns.set(key, time + definition.cooldown);
        counts.played++; played++; peak = Math.max(peak, voices.size);
        history.push({ kind: event.kind, identity: event.identity, file: definition.file, time: event.time,
          distance: mix.distance, pan: mix.pan, group: definition.group, gain: gain.gain.value });
        if (history.length > 48) history.shift();
      }
    },
    reset() {
      stop(); pending.length = shots.length = 0; observerHits.clear(); cooldowns.clear(); wetOars.clear(); waterStarts.clear(); sinking.clear();
      history.length = 0; serial = peak = 0;
      for (const key of Object.keys(counts)) counts[key] = 0;
    },
    get snapshot() { return { active: voices.size, queued: pending.length, peak, limits: TACTICAL_AUDIO_LIMITS,
      available: Object.entries(FEEDBACK_SOUNDS).filter(([, value]) => buffers[value.file]).map(([kind]) => kind),
      counts: { ...counts }, history: history.map(event => ({ ...event })) }; },
  };
}

export async function loadTacticalFeedbackAudio({ water = false, ferries = false } = {}) {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide tactical audio decoding');
  const context = new Audio(1, 1, 24000), buffers = {};
  const kinds = ['flyby', 'hit-stone', 'hit-wood', 'hit-soil', 'hit-generic',
    ...(ferries ? ['deck-step', 'oar'] : []), ...(water ? ['water-crash', 'bubbles', 'submerged-metal'] : [])];
  await Promise.all(kinds.map(async kind => {
    const file = FEEDBACK_SOUNDS[kind].file;
    const response = await fetch(`/assets/audio/tactical-feedback/${file}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Tactical audio ${file}: HTTP ${response.status}`);
    buffers[file] = await context.decodeAudioData(await response.arrayBuffer());
  }));
  return createTacticalFeedbackAudio(buffers);
}
