export const TINNITUS_CANDIDATES = Object.freeze([
  Object.freeze({ id: 'A', title: 'Soft single ring', frequencies: [1800], levels: [1], attack: .18, decay: 2.2 }),
  Object.freeze({ id: 'B', title: 'Thin high ring', frequencies: [2900, 2940], levels: [.75, .25], attack: .24, decay: 2 }),
  Object.freeze({ id: 'C', title: 'Low muted ring', frequencies: [1050, 2100], levels: [.85, .15], attack: .28, decay: 2.6 }),
  Object.freeze({ id: 'D', title: 'Soft high thread', frequencies: [4200], levels: [1], attack: .6, decay: 1.2 }),
  Object.freeze({ id: 'E', title: 'Muted low pressure', frequencies: [110, 860], levels: [.85, .15], attack: .5, decay: 1.8 }),
  Object.freeze({ id: 'F', title: 'Brief silence then fading ring', frequencies: [2200], levels: [1], onset: 1.4, attack: .4, decay: 1.5 }),
]);

export function tinnitusCandidateSamples(id, sampleRate = 48000, seconds = 7) {
  const preset = TINNITUS_CANDIDATES.find(candidate => candidate.id === id);
  if (!preset || !Number.isInteger(sampleRate) || sampleRate < 8000 ||
      preset.frequencies.some(frequency => frequency >= sampleRate / 2) || !Number.isFinite(seconds) || seconds < 1)
    throw new RangeError('Tinnitus preview requires a known candidate, sample rate and duration');
  const result = new Float32Array(Math.ceil(sampleRate * seconds));
  for (let index = 0; index < result.length; index++) {
    const time = index / sampleRate - (preset.onset ?? .6);
    if (time <= 0) continue;
    const onset = Math.min(1, time / preset.attack);
    const end = Math.min(1, (seconds - index / sampleRate) / .4);
    const envelope = onset * onset * (3 - 2 * onset) * Math.exp(-time / preset.decay) * end * end;
    let value = 0;
    for (let tone = 0; tone < preset.frequencies.length; tone++)
      value += Math.sin(2 * Math.PI * preset.frequencies[tone] * time) * preset.levels[tone];
    result[index] = value * envelope * .035;
  }
  return result;
}

// Listening sketch only: three exposure markers increase one continuous, fixed-length episode.
export function repeatedBlastPreviewSamples(sampleRate = 48000) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 8400) throw new RangeError('Invalid preview sample rate');
  const result = new Float32Array(sampleRate * 7);
  const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  for (let index = 0; index < result.length; index++) {
    const t = index / sampleRate, elapsed = t - .6;
    const onset = smooth(elapsed / .6), release = 1 - smooth((t - 4.35) / .75);
    const strength = .45 + .2 * smooth((t - 1.3) / .3) + .15 * smooth((t - 1.9) / .3);
    result[index] = Math.sin(2 * Math.PI * 4200 * elapsed) * .035 * onset * release * strength;
  }
  return result;
}
