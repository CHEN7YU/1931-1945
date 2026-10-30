export const AUDIO_GROUPS = Object.freeze(['weapons', 'voices', 'footsteps', 'effects']);
export const AUDIO_CHANNELS = Object.freeze(['master', ...AUDIO_GROUPS]);

export function defaultAudioSettings() {
  return Object.fromEntries(AUDIO_CHANNELS.map(channel => [channel, { volume: 1, muted: false }]));
}

export function validateAudioSettings(value) {
  const result = {};
  for (const channel of AUDIO_CHANNELS) {
    const setting = value?.[channel];
    if (!setting || !Number.isFinite(setting.volume) || setting.volume < 0 || setting.volume > 1 ||
        typeof setting.muted !== 'boolean') throw new RangeError(`Invalid audio setting: ${channel}`);
    result[channel] = { volume: setting.volume, muted: setting.muted };
  }
  return result;
}

export function createAudioMixer(context, initial = defaultAudioSettings()) {
  let settings = validateAudioSettings(initial);
  const master = context.createGain(), groups = {}, transients = new Set();
  master.connect(context.destination);
  for (const group of AUDIO_GROUPS) {
    groups[group] = context.createGain();
    groups[group].connect(master);
  }
  function apply(immediate = false) {
    for (const channel of AUDIO_CHANNELS) {
      const gain = (channel === 'master' ? master : groups[channel]).gain;
      const target = settings[channel].muted ? 0 : settings[channel].volume;
      gain.cancelScheduledValues(context.currentTime);
      if (immediate) gain.setValueAtTime(target, context.currentTime);
      else gain.setTargetAtTime(target, context.currentTime, .01);
    }
  }
  apply(true);
  return {
    output(group) {
      if (!AUDIO_GROUPS.includes(group)) throw new RangeError(`Unknown audio group: ${group}`);
      return groups[group];
    },
    configure(value) { settings = validateAudioSettings(value); apply(); },
    track(source, nodes, group) {
      if (!AUDIO_GROUPS.includes(group)) throw new RangeError(`Unknown transient audio group: ${group}`);
      let ended = false;
      const voice = { source, group, release() {
        if (ended) return;
        ended = true; transients.delete(voice);
        for (const node of [source, ...nodes]) node.disconnect();
      } };
      source.onended = voice.release; transients.add(voice);
    },
    reset() {
      for (const voice of [...transients]) { voice.source.stop(); voice.release(); }
    },
    get snapshot() {
      return { contextState: context.state, settings: validateAudioSettings(settings),
        gainNodes: AUDIO_CHANNELS.length, activeSynthetic: transients.size,
        syntheticGroups: Object.fromEntries(AUDIO_GROUPS.map(group =>
          [group, [...transients].filter(voice => voice.group === group).length])),
        channels: Object.fromEntries(AUDIO_CHANNELS.map(channel => {
          const own = settings[channel].muted ? 0 : settings[channel].volume;
          const total = channel === 'master' ? own : own * (settings.master.muted ? 0 : settings.master.volume);
          return [channel, { targetGain: own, effectiveGain: total,
            currentGain: (channel === 'master' ? master : groups[channel]).gain.value }];
        })) };
    },
  };
}
