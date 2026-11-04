export const SIGNAL_LIMITS = Object.freeze({ distance: 140, scanSeconds: .75, globalCooldown: 6,
  enemyCooldown: 25, minimumAdvancing: 2 });
export const SIGNAL_CLIPS = Object.freeze([
  { team: 'enemy', file: 'enemy-whistle.wav' },
]);
const nanjingStages = new Set(['gate-defense', 'withdrawal', 'dock-defense', 'withdrawal-to-boats']);

export function enemySignalsEnabled(active, nanjingStage = null) {
  if (typeof active !== 'boolean' || nanjingStage !== null && !nanjingStages.has(nanjingStage))
    throw new RangeError('Enemy signal policy requires an active-state flag and a valid campaign stage');
  return active && nanjingStage !== 'withdrawal';
}

export function signalMix(position, listener) {
  if (![position?.x, position?.y, position?.z, listener?.position?.x, listener?.position?.y, listener?.position?.z,
    listener?.right?.x, listener?.right?.y, listener?.right?.z].every(Number.isFinite))
    throw new RangeError('Battle signal mix requires finite source and listener geometry');
  const rightLength = Math.hypot(listener.right.x, listener.right.y, listener.right.z);
  if (rightLength < 1e-6) throw new RangeError('Battle signal listener orientation is degenerate');
  const dx = position.x - listener.position.x, dy = position.y + 1.5 - listener.position.y, dz = position.z - listener.position.z;
  const distance = Math.hypot(dx, dy, dz);
  return { distance, gain: .55 / (1 + distance / 35) * Math.max(0, Math.min(1, (SIGNAL_LIMITS.distance - distance) / 30)),
    pan: Math.max(-.9, Math.min(.9, (dx * listener.right.x + dy * listener.right.y + dz * listener.right.z) /
      Math.max(1, distance) / rightLength)) };
}

export function advancingSignalGroups(actors, listener) {
  const groups = new Map();
  const distance = actor => (actor.position.x - listener.position.x) ** 2 +
    (actor.position.y - listener.position.y) ** 2 + (actor.position.z - listener.position.z) ** 2;
  for (const actor of actors) {
    if (actor.team !== 'enemy' || actor.health <= 0 || actor.vehicleId || actor.groundType !== 'infantry' || actor.locomotion?.speed < .5 ||
      !Number.isFinite(actor.locomotion?.speed) || /retreat|withdraw|evacu|embark|evade|flee/.test(actor.tactics?.mode ?? '')) continue;
    const key = `${actor.team}:${actor.unitId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(actor);
  }
  return [...groups.values()].filter(group => group.length >= SIGNAL_LIMITS.minimumAdvancing).map(group => {
    const leader = group.reduce((nearest, actor) => distance(actor) < distance(nearest) ? actor : nearest);
    return { leader, mix: signalMix(leader.position, listener) };
  }).filter(group => group.mix.gain > .025).sort((a, b) => a.mix.distance - b.mix.distance ||
    a.leader.id.localeCompare(b.leader.id));
}

export function createBattleSignals(buffers) {
  for (const clip of SIGNAL_CLIPS) {
    const buffer = buffers[clip.file];
    if (!buffer || buffer.numberOfChannels !== 1 || !Number.isFinite(buffer.duration) ||
      buffer.duration < .1 || buffer.duration > 12) throw new Error(`Invalid faction signal recording: ${clip.file}`);
  }
  let output = null, active = null, nextScan = 0, globalAt = 0, nextAt = 7;
  const history = [];
  const stop = () => { const voice = active; if (voice) { voice.source.stop(); voice.release(); } };
  return {
    setOutput(node) { output = node; },
    sync(enabled) { if (!enabled) stop(); },
    update(context, actors, listener, time, enabled) {
      if (!Number.isFinite(time) || time < 0) throw new RangeError('Battle signals require finite simulation time');
      if (!enabled || !context || context.state !== 'running') { stop(); return null; }
      if (active) {
        const leader = actors.find(actor => actor.id === active.soldierId && actor.health > 0 && !actor.vehicleId);
        if (!leader) stop();
        else {
          const mix = signalMix(leader.position, listener);
          active.gain.gain.setTargetAtTime(mix.gain, context.currentTime, .08);
          active.pan.pan.setTargetAtTime(mix.pan, context.currentTime, .08);
          if (!mix.gain) stop();
        }
      }
      if (active || time < nextScan || time < globalAt || time < nextAt) return null;
      nextScan = time + SIGNAL_LIMITS.scanSeconds;
      const selected = advancingSignalGroups(actors, listener)[0];
      if (!selected) return null;
      const { leader, mix } = selected, clip = SIGNAL_CLIPS[0];
      const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
      source.buffer = buffers[clip.file]; gain.gain.value = mix.gain; pan.pan.value = mix.pan;
      source.connect(gain).connect(pan).connect(output ?? context.destination);
      const voice = { source, gain, pan, soldierId: leader.id, released: false, release() {
        if (voice.released) return;
        voice.released = true; source.disconnect(); gain.disconnect(); pan.disconnect();
        if (active === voice) active = null;
      } };
      source.onended = voice.release; active = voice;
      const report = { team: leader.team, file: clip.file, soldierId: leader.id, unitId: leader.unitId,
        time, distance: mix.distance };
      history.push(report); if (history.length > 32) history.shift();
      nextAt = time + SIGNAL_LIMITS.enemyCooldown;
      globalAt = time + SIGNAL_LIMITS.globalCooldown;
      source.start(); return report;
    },
    reset() { stop(); nextScan = globalAt = 0; nextAt = 7; history.length = 0; },
    get snapshot() { return { active: Boolean(active), limits: SIGNAL_LIMITS, history: history.map(item => ({ ...item })) }; },
  };
}

export async function loadBattleSignals() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide recorded signal decoding');
  const context = new Audio(1, 1, 24000), buffers = {};
  for (const clip of SIGNAL_CLIPS) {
    const response = await fetch(`/assets/audio/battle-signals/${clip.file}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Faction signal ${clip.file}: HTTP ${response.status}`);
    buffers[clip.file] = await context.decodeAudioData(await response.arrayBuffer());
  }
  return createBattleSignals(buffers);
}
