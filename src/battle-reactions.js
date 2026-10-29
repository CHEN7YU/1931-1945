import { battleVoiceMix, soldierVoiceVariant } from './battle-voices.js';
import { ADDITIONAL_REACTION_CLIPS, reactionClips } from './battle-reaction-clips.js';

export { ADDITIONAL_REACTION_CLIPS, reactionClips } from './battle-reaction-clips.js';

export const REACTION_LIMITS = Object.freeze({ interval: 1.5, soldierCooldown: 8, distance: 35, stateAge: 1 });

export function selectHurtReaction(variant, value, previousFile = null) {
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid reaction selection value');
  const candidates = [0, 1].map(take => ({ file: `${variant}-hurt-${take}.wav`, selectionWeight: 1 }))
    .concat(ADDITIONAL_REACTION_CLIPS).filter(clip => clip.file !== previousFile);
  let remaining = value * candidates.reduce((sum, clip) => sum + clip.selectionWeight, 0);
  for (const clip of candidates) {
    if (remaining < clip.selectionWeight) return clip.file;
    remaining -= clip.selectionWeight;
  }
  throw new Error('Unable to select a combat reaction');
}

export function battleReactionCue(actor, time) {
  if (actor.health <= 0 || actor.vehicleId || actor.groundType !== 'infantry') return null;
  if (actor.tactics?.suppressedUntil > time) return 'cover';
  const threat = actor.target?.health > 0 ? actor.target.position : actor.tactics?.forgetAt > time ? actor.tactics.lastSeen : null;
  if (actor.locomotion?.speed > 1.5 && ['assault', 'advance-to-objective'].includes(actor.tactics?.mode) && threat &&
    Math.hypot(threat.x - actor.position.x, threat.z - actor.position.z) < 30) return 'charge';
  return null;
}

export function createBattleReactions(buffers, random = Math.random, occluded = () => false) {
  for (const clip of reactionClips()) {
    const buffer = buffers[clip.file];
    if (!buffer || buffer.numberOfChannels !== 1 || !Number.isFinite(buffer.duration) ||
      buffer.duration < .08 || buffer.duration > (clip.maxDuration ?? 2)) {
      throw new Error(`Invalid combat reaction buffer: ${clip.file}`);
    }
  }
  const states = new Map(), cooldowns = new Map(), takes = new Map(), history = [];
  let enabled = false, active = null, next = 0, lastHurtFile = null;
  const counts = { hurt: 0, cover: 0, charge: 0 };
  function mixAt(position, listener) {
    const mix = battleVoiceMix(position, listener);
    if (mix.distance < REACTION_LIMITS.distance && occluded(position, listener)) {
      mix.gain *= .35; mix.cutoff = Math.min(mix.cutoff, 1200);
    }
    return mix;
  }
  function stop() {
    if (!active) return;
    const voice = active; active = null;
    voice.source.stop(); voice.release();
  }
  function play(audio, actor, cue, listener, time, priority) {
    if (!enabled || audio?.state !== 'running' || priority || active || time < next ||
      time < (cooldowns.get(actor.id) ?? 0) || actor.vehicleId || actor.groundType !== 'infantry') return false;
    const mix = mixAt(actor.position, listener);
    if (mix.distance >= REACTION_LIMITS.distance) return false;
    const variant = soldierVoiceVariant(actor.id), key = `${variant}-${cue}`, take = ((takes.get(key) ?? -1) + 1) % 2;
    const file = cue === 'hurt' ? selectHurtReaction(variant, random(), lastHurtFile) : `${key}-${take}.wav`;
    const source = audio.createBufferSource(), gain = audio.createGain();
    const filter = audio.createBiquadFilter(), panner = audio.createStereoPanner();
    source.buffer = buffers[file]; filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
    gain.gain.value = mix.gain * .8; panner.pan.value = mix.pan;
    source.connect(filter).connect(gain).connect(panner).connect(audio.destination);
    let released = false;
    const voice = { source, gain, filter, panner, cue, actorId: actor.id, position: { ...actor.position },
      release() {
        if (released) return;
        released = true;
        if (active === voice) active = null;
        source.disconnect(); gain.disconnect(); filter.disconnect(); panner.disconnect();
      } };
    source.onended = voice.release; active = voice;
    if (cue === 'hurt') lastHurtFile = file;
    else takes.set(key, take);
    cooldowns.set(actor.id, time + REACTION_LIMITS.soldierCooldown);
    next = time + REACTION_LIMITS.interval; counts[cue]++;
    history.push({ cue, file, soldierId: actor.id, team: actor.team, time, distance: mix.distance });
    if (history.length > 64) history.shift();
    source.start();
    return true;
  }
  return {
    sync(value) { enabled = value; if (!value) stop(); },
    damage(audio, event, actor, listener, priority = false) {
      if (event.type !== 'damage' || event.target.kind !== 'soldier' || event.source.credit === 'environment' ||
        !actor || actor.id !== event.target.id || random() >= .65) return false;
      return play(audio, actor, 'hurt', listener, event.time, priority);
    },
    update(audio, actors, listener, time, priority = false, battlefield = true) {
      if (!enabled || audio?.state !== 'running') return;
      if (priority || !battlefield) stop();
      if (active) {
        const actor = actors.find(actor => actor.id === active.actorId);
        if (actor?.vehicleId || actor?.health <= 0 && active.cue !== 'hurt') stop();
        else {
          if (actor) active.position = { ...actor.position };
          const mix = mixAt(active.position, listener);
          if (mix.distance >= REACTION_LIMITS.distance) stop();
          else {
            active.gain.gain.setTargetAtTime(mix.gain * .8, audio.currentTime, .03);
            active.panner.pan.setTargetAtTime(mix.pan, audio.currentTime, .03);
            active.filter.frequency.setTargetAtTime(mix.cutoff, audio.currentTime, .03);
          }
        }
      }
      const liveIds = new Set(actors.map(actor => actor.id));
      for (const map of [states, cooldowns]) for (const id of map.keys()) if (!liveIds.has(id)) map.delete(id);
      for (const actor of actors) {
        const cue = battleReactionCue(actor, time), previous = states.get(actor.id);
        states.set(actor.id, { cue, time });
        if (!battlefield || actor.id === listener.soldierId || !cue || previous?.cue === cue ||
          previous && time - previous.time > REACTION_LIMITS.stateAge || random() >= .45) continue;
        play(audio, actor, cue, listener, time, priority);
      }
    },
    reset() {
      stop(); states.clear(); cooldowns.clear(); takes.clear(); history.length = 0; next = 0; lastHurtFile = null;
      for (const cue of Object.keys(counts)) counts[cue] = 0;
    },
    get snapshot() { return { status: 'recorded', active: Number(Boolean(active)), counts: { ...counts },
      history: history.map(item => ({ ...item })), limits: { ...REACTION_LIMITS } }; },
  };
}

export async function loadBattleReactions(occluded) {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide combat reaction decoding');
  const context = new Audio(1, 1, 24000), buffers = {};
  await Promise.all(reactionClips().map(async clip => {
    const response = await fetch(`/assets/audio/battle-reactions/${clip.file}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Combat reaction ${clip.file}: HTTP ${response.status}`);
    buffers[clip.file] = await context.decodeAudioData(await response.arrayBuffer());
  }));
  return createBattleReactions(buffers, Math.random, occluded);
}
