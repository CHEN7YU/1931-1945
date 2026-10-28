import { battleVoiceClips } from './battle-voice-lines.js';

export const BATTLE_VOICE_LIMITS = Object.freeze({ distance: 55, interval: 5, teamCooldown: 9, soldierCooldown: 28, queue: 32,
  calloutDistance: 18, calloutInterval: 8, calloutTargetCooldown: 24, calloutSpeakerCooldown: 12, observationAge: 1.2 });
const point = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
const ambientCues = new Set(['advance', 'contact', 'cover', 'reload', 'grenade']);

export function soldierVoiceVariant(id) {
  if (typeof id !== 'string' || !id) throw new RangeError('Battle voice requires a soldier identity');
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 3;
}

export function battleVoiceCue(actor, time) {
  if (actor.health <= 0 || actor.vehicleId || actor.groundType !== 'infantry') return null;
  if (actor.tactics?.mode === 'evade-grenade') return 'grenade';
  if (actor.rifle?.action === 'reload') return 'reload';
  if (actor.tactics?.suppressedUntil > time) return 'cover';
  if (actor.target?.health > 0 || actor.tactics?.lastSeen && actor.tactics.forgetAt > time) return 'contact';
  return actor.locomotion?.speed > .5 ? 'advance' : null;
}

export function battleVoiceMix(position, listener) {
  if (!point(position) || !point(listener?.position) || !point(listener?.right)) throw new RangeError('Invalid battle voice listener or position');
  const dx = position.x - listener.position.x, dy = position.y + 1.5 - listener.position.y, dz = position.z - listener.position.z;
  const distance = Math.hypot(dx, dy, dz), rightLength = Math.hypot(listener.right.x, listener.right.y, listener.right.z);
  if (rightLength < 1e-6) throw new RangeError('Battle voice listener orientation is degenerate');
  const fade = Math.max(0, Math.min(1, (BATTLE_VOICE_LIMITS.distance - distance) / 15));
  return { distance, gain: .65 / (1 + Math.max(0, distance - 3) / 10) * fade,
    pan: Math.max(-.9, Math.min(.9, (dx * listener.right.x + dy * listener.right.y + dz * listener.right.z) / Math.max(1, distance) / rightLength)),
    cutoff: Math.max(1700, 10000 / (1 + distance / 25)) };
}

export function battleClockDirection(target, listener) {
  if (!point(target) || !point(listener?.position) || !point(listener?.right)) throw new RangeError('Invalid clock direction geometry');
  const { x, z } = listener.right, length = Math.hypot(x, z);
  if (length < 1e-6) throw new RangeError('Clock direction requires a horizontal listener orientation');
  const dx = target.x - listener.position.x, dz = target.z - listener.position.z;
  if (Math.hypot(dx, dz) < .5) return null;
  const angle = Math.atan2((dx * x + dz * z) / length, (dx * z - dz * x) / length);
  return ((Math.round(angle / (Math.PI / 6)) + 12) % 12) || 12;
}

export function findBattleCallout(actors, listener, time, canSee) {
  if (!Number.isFinite(time) || time < 0 || typeof canSee !== 'function' ||
    !point(listener?.position) || !point(listener?.right)) throw new RangeError('Callouts require listener geometry, simulation time and an explicit sight query');
  const player = actors.find(actor => actor.id === listener.soldierId);
  if (!player || player.health <= 0 || player.team !== 'friendly') return null;
  const byId = new Map(actors.map(actor => [actor.id, actor])), candidates = [];
  for (const observer of actors) {
    if (observer.id === player.id || observer.team !== 'friendly' || observer.health <= 0 || observer.vehicleId ||
      observer.groundType !== 'infantry' || observer.rifle?.action === 'reload' || observer.tactics?.mode === 'evade-grenade') continue;
    const speakerDistance = Math.hypot(observer.position.x - listener.position.x,
      observer.position.y - player.position.y, observer.position.z - listener.position.z);
    if (speakerDistance > BATTLE_VOICE_LIMITS.calloutDistance) continue;
    const sight = observer.tactics?.lastSightCheck;
    if (observer.tactics?.threatSense !== 'vision' || !sight?.visible || sight.targetId !== observer.tactics.threatId ||
      !Number.isFinite(sight.time) || time < sight.time || time - sight.time > BATTLE_VOICE_LIMITS.observationAge) continue;
    const target = byId.get(sight.targetId);
    if (!target || target.team !== 'enemy' || target.health <= 0) continue;
    const targetRole = target.targetKind === 'closed-armor' && target.vehicleId ? 'tank' :
      !target.vehicleId && target.groundType === 'infantry' && ['sniper', 'machine-gunner'].includes(target.role) ? target.role : null;
    if (!targetRole) continue;
    const targetDistance = Math.hypot(target.position.x - listener.position.x, target.position.z - listener.position.z);
    if (targetDistance > 75 || battleClockDirection(target.position, listener) === null) continue;
    candidates.push({ observer, target, targetRole, targetKey: target.vehicleId ?? target.id, speakerDistance, targetDistance });
  }
  const priority = { tank: 0, sniper: 1, 'machine-gunner': 2 };
  candidates.sort((a, b) => priority[a.targetRole] - priority[b.targetRole] ||
    a.targetDistance - b.targetDistance || a.speakerDistance - b.speakerDistance || a.observer.id.localeCompare(b.observer.id));
  return candidates.find(({ observer, target }) => canSee(observer, target)) ?? null;
}

export function createObjectiveVoiceTracker() {
  const states = new Map();
  return {
    update(objective, status) {
      const previous = states.get(objective.id) ?? { progress: 0, owner: null, contested: false };
      const cues = [];
      if (previous.owner === 'friendly' && objective.owner !== 'friendly') cues.push('lost');
      if (previous.owner !== 'friendly' && objective.owner === 'friendly') cues.push('captured');
      else if (objective.owner !== 'friendly') {
        if (previous.progress === 0 && objective.progress > 0) cues.push('capturing');
        if (previous.owner !== 'friendly' && previous.progress > 0 && objective.progress === 0) cues.push('setback');
      }
      if (status === 'contested' && !previous.contested) cues.push('contested');
      states.set(objective.id, { progress: objective.progress, owner: objective.owner,
        contested: status === 'contested' || previous.owner === objective.owner && previous.contested });
      return cues;
    },
    reset() { states.clear(); },
  };
}

export function createBattleVoices(buffers, random = Math.random) {
  const clips = battleVoiceClips(), voices = new Map(), queue = [], history = [];
  const teamAt = new Map(), soldierAt = new Map(), lastLine = new Map();
  const calloutTargetAt = new Map(), calloutSpeakerAt = new Map();
  for (const clip of clips) {
    const buffer = buffers[clip.file];
    if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= .1 || buffer.duration > 10 || buffer.numberOfChannels !== 1) {
      throw new RangeError(`Battle voice requires a short mono clip: ${clip.file}`);
    }
  }
  let enabled = false, nextAmbient = 2, nextScan = 0, nextCallout = 0, nextCalloutScan = 0, context = null;
  const counts = { ambient: 0, callout: 0, command: 0, announcement: 0, interrupted: 0, queuePressure: 0 };
  const choose = items => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  function select(team, cue, variant) {
    const key = `${team}:${cue}`, candidates = clips.filter(clip => clip.team === team && clip.cue === cue && clip.variant === variant);
    if (!candidates.length) throw new Error(`Unknown battle voice cue: ${team}/${cue}/${variant}`);
    const fresh = candidates.filter(clip => clip.id !== lastLine.get(key)), clip = choose(fresh.length ? fresh : candidates);
    lastLine.set(key, clip.id);
    return clip;
  }
  function stop(channel, replay = false) {
    const voice = voices.get(channel);
    if (!voice) return;
    if (replay && channel === 'announcement') queue.unshift(voice.request);
    voice.source.stop(); voice.release();
  }
  function start(channel, request, mix = { gain: .78, pan: 0, cutoff: 12000 }) {
    if (!enabled || !context || context.state !== 'running') return false;
    if (voices.has(channel)) { stop(channel); counts.interrupted++; }
    if (channel === 'command') stop('announcement', true);
    if (channel !== 'ambient') stop('ambient');
    if (channel === 'command' || channel === 'announcement') stop('callout');
    const source = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner(), filter = context.createBiquadFilter();
    source.buffer = buffers[request.clip.file];
    filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
    gain.gain.value = mix.gain; panner.pan.value = mix.pan;
    source.connect(filter).connect(gain).connect(panner).connect(context.destination);
    let ended = false;
    const voice = { source, gain, filter, panner, request, release() {
      if (ended) return;
      ended = true;
      if (voices.get(channel) === voice) voices.delete(channel);
      source.disconnect(); gain.disconnect(); panner.disconnect(); filter.disconnect();
    } };
    source.onended = voice.release; voices.set(channel, voice);
    counts[channel]++;
    history.push({ channel, cue: request.clip.cue, team: request.clip.team, file: request.clip.file,
      text: request.clip.text, voice: request.clip.voice, soldierId: request.soldierId ?? null,
      eventKey: request.eventKey ?? null, time: request.time, distance: mix.distance ?? 0,
      ...(request.targetId ? { targetId: request.targetId, targetKey: request.targetKey, targetRole: request.targetRole, clock: request.clock,
        listenerId: request.listenerId } : {}) });
    if (history.length > 64) history.shift();
    source.start();
    return true;
  }
  function flush() {
    if (!voices.has('command') && !voices.has('announcement') && queue.length && enabled && context?.state === 'running') {
      const request = queue.shift();
      start(request.channel, request);
    }
  }
  return {
    sync(active) {
      enabled = active;
      if (!active) {
        stop('ambient'); stop('callout'); stop('command'); stop('announcement', true);
      }
    },
    event(audio, cue, { soldierId = 'commander', team = 'friendly', time = 0, eventKey = null, command = false } = {}) {
      if (!Number.isFinite(time) || time < 0 || !['friendly', 'enemy'].includes(team)) throw new RangeError('Invalid battle voice event');
      context = audio;
      const request = { clip: select(team, cue, soldierVoiceVariant(soldierId)), soldierId, time, eventKey,
        channel: command ? 'command' : 'announcement' };
      if (command && start('command', request)) return;
      if (queue.length >= BATTLE_VOICE_LIMITS.queue) {
        counts.queuePressure++;
        console.warn('Battle voice queue pressure: interrupting the current announcement to deliver pending events');
        stop('announcement'); stop('command'); flush();
        if (queue.length >= BATTLE_VOICE_LIMITS.queue) throw new Error('Battle voice events cannot be delivered while audio is suspended');
      }
      queue.push(request); flush();
    },
    update(audio, actors, listener, time, ambient = true, canSee = null) {
      context = audio;
      if (!enabled || !audio || audio.state !== 'running') return;
      flush();
      for (const channel of ['ambient', 'callout']) {
        const voice = voices.get(channel);
        if (!voice) continue;
        const actor = actors.find(actor => actor.id === voice.request.soldierId && actor.health > 0 && !actor.vehicleId);
        const staleCallout = channel === 'callout' && (voice.request.listenerId !== listener.soldierId ||
          !actors.some(target => target.id === voice.request.targetId && target.health > 0));
        if (!actor || !ambient || staleCallout) stop(channel);
        else {
          const mix = battleVoiceMix(actor.position, listener);
          if (!mix.gain) stop(channel);
          else {
            voice.gain.gain.setTargetAtTime(mix.gain, audio.currentTime, .05);
            voice.panner.pan.setTargetAtTime(mix.pan, audio.currentTime, .05);
            voice.filter.frequency.setTargetAtTime(mix.cutoff, audio.currentTime, .05);
          }
        }
      }
      if (ambient && canSee && !queue.length && !voices.has('command') && !voices.has('announcement') &&
        !voices.has('callout') && time >= nextCallout && time >= nextCalloutScan) {
        nextCalloutScan = time + .35;
        const liveIds = new Set(actors.filter(actor => actor.health > 0).flatMap(actor => [actor.id, actor.vehicleId].filter(Boolean)));
        for (const map of [calloutTargetAt, calloutSpeakerAt]) for (const id of map.keys()) if (!liveIds.has(id)) map.delete(id);
        const report = findBattleCallout(actors, listener, time, (observer, target) =>
          time >= (calloutTargetAt.get(target.vehicleId ?? target.id) ?? 0) &&
          time >= (calloutSpeakerAt.get(observer.id) ?? 0) && canSee(observer, target));
        if (report) {
          const { observer, target, targetRole, targetKey } = report, clock = battleClockDirection(target.position, listener);
          const request = { clip: select('friendly', `callout-${targetRole}-${clock}`, soldierVoiceVariant(observer.id)),
            soldierId: observer.id, targetId: target.id, targetKey, targetRole, clock, listenerId: listener.soldierId, time };
          if (start('callout', request, battleVoiceMix(observer.position, listener))) {
            calloutTargetAt.set(targetKey, time + BATTLE_VOICE_LIMITS.calloutTargetCooldown);
            calloutSpeakerAt.set(observer.id, time + BATTLE_VOICE_LIMITS.calloutSpeakerCooldown);
            nextCallout = time + BATTLE_VOICE_LIMITS.calloutInterval;
            nextAmbient = Math.max(nextAmbient, time + BATTLE_VOICE_LIMITS.interval);
          }
        }
      }
      if (!ambient || voices.size || queue.length || time < nextAmbient || time < nextScan) return;
      nextScan = time + .35;
      const liveIds = new Set(actors.map(actor => actor.id));
      for (const id of soldierAt.keys()) if (!liveIds.has(id)) soldierAt.delete(id);
      const candidates = actors.filter(actor => actor.id !== listener.soldierId && actor.health > 0 &&
        ['friendly', 'enemy'].includes(actor.team) && time >= (teamAt.get(actor.team) ?? 0) &&
        time >= (soldierAt.get(actor.id) ?? 0) && battleVoiceCue(actor, time) &&
        battleVoiceMix(actor.position, listener).gain > .025);
      if (!candidates.length) return;
      const teams = [...new Set(candidates.map(actor => actor.team))], team = choose(teams);
      const actor = choose(candidates.filter(actor => actor.team === team)), cue = battleVoiceCue(actor, time);
      if (!ambientCues.has(cue)) throw new Error('Invalid ambient battle voice cue');
      const request = { clip: select(team, cue, soldierVoiceVariant(actor.id)), soldierId: actor.id, time };
      if (start('ambient', request, battleVoiceMix(actor.position, listener))) {
        teamAt.set(team, time + BATTLE_VOICE_LIMITS.teamCooldown);
        soldierAt.set(actor.id, time + BATTLE_VOICE_LIMITS.soldierCooldown);
        nextAmbient = time + BATTLE_VOICE_LIMITS.interval + random() * 3;
      }
    },
    reset() {
      for (const channel of [...voices.keys()]) stop(channel);
      queue.length = history.length = 0;
      teamAt.clear(); soldierAt.clear(); lastLine.clear();
      calloutTargetAt.clear(); calloutSpeakerAt.clear();
      nextAmbient = 2; nextScan = 0; nextCallout = nextCalloutScan = 0;
      for (const key of Object.keys(counts)) counts[key] = 0;
    },
    get priorityActive() { return queue.length > 0 || ['command', 'announcement', 'callout'].some(channel => voices.has(channel)); },
    get snapshot() {
      return { status: 'ready', clips: clips.length, enabled, active: voices.size, queued: queue.length,
        counts: { ...counts }, history: history.map(item => ({ ...item })), limits: { ...BATTLE_VOICE_LIMITS } };
    },
  };
}

export async function loadBattleVoices() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide battle voice decoding');
  const context = new Audio(1, 1, 24000), clips = battleVoiceClips(), buffers = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < clips.length) {
      const clip = clips[cursor++];
      const response = await fetch(`/assets/audio/battle-voices/${clip.file}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Battle voice ${clip.file}: HTTP ${response.status}`);
      buffers[clip.file] = await context.decodeAudioData(await response.arrayBuffer());
    }
  }));
  return createBattleVoices(buffers);
}
