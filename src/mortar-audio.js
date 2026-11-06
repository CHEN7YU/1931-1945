export async function loadMortarLaunch() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Offline audio decoding is unavailable');
  const response = await fetch('/assets/audio/mortar/launch.wav', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Mortar launch audio HTTP ${response.status}`);
  const buffer = await new Audio(1, 1, 24000).decodeAudioData(await response.arrayBuffer());
  if (buffer.numberOfChannels !== 1 || buffer.duration < .5 || buffer.duration > 2) throw new Error('Invalid mortar launch audio');
  return buffer;
}

export function playMortarLaunch(context, buffer, mixer, volume = .9) {
  if (context.state !== 'running') return false;
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(mixer.output('weapons'));
  mixer.track(source, [gain], 'weapons');
  source.start();
  return true;
}
