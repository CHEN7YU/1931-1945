import { civilianVoiceClips } from './civilian-voice-lines.js';
import { battleVoiceMix, soldierVoiceVariant } from './battle-voices.js';

export function createCivilianVoiceDirector(clips = civilianVoiceClips(), random = Math.random) {
  const usedAt = new Map(), speakerAt = new Map();
  const encounterClips = clips.filter(clip => Number.isInteger(clip.encounterOrder)).sort((a, b) => a.encounterOrder - b.encounterOrder);
  let nextAt = 0, encounterAt = null, encounterIndex = 0;
  return {
    reset() { usedAt.clear(); speakerAt.clear(); nextAt = 0; encounterAt = null; encounterIndex = 0; },
    encounter(now) {
      if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid civilian encounter time');
      if (encounterAt !== null || !encounterClips.length) return false;
      encounterAt = now; nextAt = now;
      return true;
    },
    get encounterPending() { return encounterAt !== null && encounterIndex < encounterClips.length; },
    select(civilians, listener, stage, now, soldiers = [], hostiles = []) {
      if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid civilian voice time');
      if (!['gate-defense', 'withdrawal', 'dock-defense', 'withdrawal-to-boats'].includes(stage) || now < nextAt) return null;
      const opening = stage === 'gate-defense';
      const candidates = civilians.filter(person => person.visible && person.userData.active &&
        !person.userData.dead && !person.userData.boarding && !person.userData.evacuated &&
        (!opening || person.userData.openingWave && person.position.z > -10) &&
        (encounterAt !== null && encounterIndex < encounterClips.length ||
          now >= (speakerAt.get(person.userData.civilianId) ?? 0)) &&
        Math.hypot(person.position.x - listener.position.x, person.position.z - listener.position.z) < 34);
      if (!candidates.length) return null;
      if (!opening && encounterAt !== null && encounterIndex < encounterClips.length) {
        if (now - encounterAt < 40) {
          const clip = encounterClips[encounterIndex];
          const person = candidates.filter(person => person.userData.ageGroup === clip.age &&
            person.userData.presentation === clip.presentation)
            .sort((a, b) => Math.hypot(a.position.x - listener.position.x, a.position.z - listener.position.z) -
              Math.hypot(b.position.x - listener.position.x, b.position.z - listener.position.z))[0];
          if (!person) { nextAt = now + .25; return null; }
          encounterIndex++; nextAt = now + .1; usedAt.set(clip.text, now);
          return { clip, person };
        }
        encounterIndex = encounterClips.length;
      }
      let choices = candidates.flatMap(person => {
        const zone = opening ? 'gate' : person.position.x < -39 && person.position.z < -65 ? 'dock' : 'city';
        return clips.filter(clip => clip.encounterOrder === undefined && clip.phase === (opening ? 'opening' : 'retreat') &&
          clip.speakerKind === 'civilian' && clip.age === person.userData.ageGroup &&
          clip.presentation === person.userData.presentation && (clip.zone === 'both' || clip.zone === zone))
          .map(clip => ({ clip, person }));
      });
      if (opening) {
        const behindCivilians = candidates.some(person => hostiles.some(enemy => enemy.health > 0 &&
          !enemy.vehicleId && enemy.position.z > person.position.z &&
          Math.hypot(enemy.position.x - person.position.x, enemy.position.z - person.position.z) < 30));
        const military = soldiers.filter(actor => actor.health > 0 && !actor.vehicleId &&
          actor.id !== listener.soldierId && Math.hypot(actor.position.x - listener.position.x,
            actor.position.z - listener.position.z) < 34 &&
          now >= (speakerAt.get(`soldier:${actor.id}`) ?? 0));
        const soldierChoices = military.flatMap(actor => clips.filter(clip => clip.speakerKind === 'soldier' &&
          clip.variant === soldierVoiceVariant(actor.id) % 2 &&
          (clip.cue !== 'shield' || behindCivilians)).map(clip => ({ clip, person: {
          actor, position: actor.position, visible: true,
          userData: { civilianId: `soldier:${actor.id}`, active: true },
        } })));
        if (soldierChoices.length && random() < .28) choices = soldierChoices;
      }
      if (!choices.length) return null;
      const fresh = choices.filter(({ clip }) => now - (usedAt.get(clip.text) ?? -Infinity) >= 150);
      if (!fresh.length) {
        // A sparse part of the city cannot reset the whole catalogue and immediately repeat its own few lines.
        nextAt = now + 8;
        return null;
      }
      const choice = fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
      usedAt.set(choice.clip.text, now);
      speakerAt.set(choice.person.userData.civilianId, now + 28);
      nextAt = now + 4 + random() * 3;
      return choice;
    },
  };
}

export function createCivilianVoices(buffers) {
  const clips = civilianVoiceClips(), director = createCivilianVoiceDirector(clips);
  for (const clip of clips) {
    const buffer = buffers[clip.file];
    if (!buffer || buffer.numberOfChannels !== 1 || buffer.duration <= .1 || buffer.duration > 15)
      throw new Error(`Invalid civilian audio buffer: ${clip.file}`);
  }
  const playing = new Set(), counts = { spoken: 0, encounters: 0, encounterSpoken: 0 };
  let output;
  const stop = () => {
    for (const voice of playing) voice.source.stop();
    playing.clear();
  };
  return {
    setOutput(node) { output = node; },
    reset() { stop(); director.reset(); counts.spoken = counts.encounters = counts.encounterSpoken = 0; },
    encounter(now) { if (director.encounter(now)) { stop(); counts.encounters++; } },
    sync(enabled) { if (!enabled) stop(); },
    get snapshot() { return { ...counts, active: playing.size, clips: clips.length }; },
    update(context, civilians, listener, stage, now, enabled, priority, soldiers = [], hostiles = []) {
      if (!enabled) { stop(); return; }
      if (!context || context.state !== 'running' || !output) return;
      for (const voice of playing) {
        const person = voice.person;
        const mix = battleVoiceMix(person.position, listener);
        if (person.userData.dead || person.userData.evacuated || person.actor?.health <= 0 ||
          !person.visible || mix.distance > 40 || voice.phase !== (stage === 'gate-defense' ? 'opening' : 'retreat')) {
          voice.source.stop(); playing.delete(voice); continue;
        }
        voice.gain.gain.setTargetAtTime(mix.gain * (priority ? .12 : .8), context.currentTime, .08);
        voice.pan.pan.setTargetAtTime(mix.pan, context.currentTime, .08);
      }
      if (priority || playing.size >= 2 || director.encounterPending && playing.size > 0 ||
        [...playing].some(voice => voice.encounter)) return;
      const choice = director.select(civilians, listener, stage, now, soldiers, hostiles);
      if (!choice) return;
      const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
      const filter = context.createBiquadFilter(), mix = battleVoiceMix(choice.person.position, listener);
      source.buffer = buffers[choice.clip.file];
      gain.gain.value = mix.gain * .8; pan.pan.value = mix.pan;
      filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
      source.connect(filter).connect(gain).connect(pan).connect(output);
      const voice = { source, gain, pan, person: choice.person, phase: choice.clip.phase,
        encounter: Number.isInteger(choice.clip.encounterOrder) };
      source.onended = () => { playing.delete(voice); source.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); };
      playing.add(voice); counts.spoken++;
      if (voice.encounter) counts.encounterSpoken++;
      source.start();
    },
  };
}

export async function loadCivilianVoices() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide civilian voice decoding');
  const context = new Audio(1, 1, 24000), clips = civilianVoiceClips(), buffers = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < clips.length) {
      const clip = clips[cursor++];
      const revision=clip.audioRevision?`?v=${encodeURIComponent(clip.audioRevision)}`:'';
      const response = await fetch(`/assets/audio/civilian-voices/${clip.file}${revision}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Civilian voice ${clip.file}: HTTP ${response.status}`);
      buffers[clip.file] = await context.decodeAudioData(await response.arrayBuffer());
    }
  }));
  return createCivilianVoices(buffers);
}
